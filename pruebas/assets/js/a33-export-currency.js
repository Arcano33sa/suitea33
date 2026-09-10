/*
  Suite A33 — Export Currency Bridge
  Capa segura de exportaciones para leer Configuración → Moneda sin recalcular montos.
*/
(function(global){
  'use strict';

  const STORAGE_KEY = 'suite_a33_currency_settings_v1';
  const BRIDGE_VERSION = 2;
  const PRIMARY = Object.freeze({ name: 'Córdoba nicaragüense', symbol: 'C$', code: 'NIO' });
  const SECONDARY = Object.freeze({ name: 'Dólar estadounidense', symbol: 'US$', code: 'USD' });

  function cloneCurrency(src, fallback){
    const base = fallback || PRIMARY;
    const obj = (src && typeof src === 'object') ? src : {};
    return {
      name: String(obj.name || base.name || '').trim(),
      symbol: String(obj.symbol || base.symbol || '').trim(),
      code: String(obj.code || base.code || '').trim().toUpperCase()
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
        if (global.localStorage && typeof global.localStorage.getItem === 'function'){
          raw = global.localStorage.getItem(STORAGE_KEY) || '';
        }
      }catch(_){ raw = ''; }
    }
    return raw;
  }

  function normalizeRate(value){
    if (global.A33Currency && typeof global.A33Currency.normalizeExchangeRateValue === 'function'){
      return global.A33Currency.normalizeExchangeRateValue(value);
    }
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw || !/^\d+(?:\.\d{0,2})?$/.test(raw)) return '';
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
  }

  function readFallbackSettings(){
    const raw = readRawStorage();
    if (!raw){
      return { primary: cloneCurrency(PRIMARY, PRIMARY), secondary: cloneCurrency(SECONDARY, SECONDARY), exchangeRate: '', updatedAt: '' };
    }
    try{
      const parsed = JSON.parse(raw);
      return {
        primary: cloneCurrency(PRIMARY, PRIMARY),
        secondary: cloneCurrency(SECONDARY, SECONDARY),
        exchangeRate: normalizeRate(parsed && parsed.exchangeRate),
        updatedAt: String(parsed && parsed.updatedAt || '').trim()
      };
    }catch(_){
      return { primary: cloneCurrency(PRIMARY, PRIMARY), secondary: cloneCurrency(SECONDARY, SECONDARY), exchangeRate: normalizeRate(raw), updatedAt: '' };
    }
  }

  function pad2(n){ return String(n).padStart(2, '0'); }

  function formatDateTime(value){
    const raw = String(value || '').trim();
    if (!raw) return 'Sin registros';
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return raw;
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function parseAmount(value){
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let raw = String(value ?? '').trim();
    if (!raw) return 0;
    raw = raw.replace(/[^0-9,.-]/g, '');
    const hasComma = raw.includes(',');
    const hasDot = raw.includes('.');
    if (hasComma && hasDot) raw = raw.replace(/,/g, '');
    else if (hasComma && !hasDot) raw = raw.replace(',', '.');
    const firstMinus = raw.indexOf('-');
    raw = raw.replace(/-/g, '');
    if (firstMinus === 0) raw = '-' + raw;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function formatNumber2(value){
    const safe = parseAmount(value);
    const sign = safe < 0 ? '-' : '';
    const fixed = Math.abs(safe).toFixed(2);
    const parts = fixed.split('.');
    return `${sign}${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${parts[1] || '00'}`;
  }

  function getState(){
    let state = null;
    try{
      if (global.A33Currency && typeof global.A33Currency.getState === 'function'){
        state = global.A33Currency.getState();
      }
    }catch(_){ state = null; }

    const settings = (state && state.settings) ? state.settings : readFallbackSettings();
    const primary = cloneCurrency((state && state.primary) || settings.primary, PRIMARY);
    const secondary = cloneCurrency((state && state.secondary) || settings.secondary, SECONDARY);
    const rate = normalizeRate(settings.exchangeRate || (state && state.exchangeRate));
    const hasRate = !!rate;
    const updatedAtRaw = String(settings.updatedAt || '').trim();

    return {
      ok: true,
      bridgeVersion: BRIDGE_VERSION,
      engineVersion: state && state.engineVersion ? state.engineVersion : (global.A33Currency && global.A33Currency.version) || 0,
      storageKey: STORAGE_KEY,
      primary,
      secondary,
      primaryText: `${primary.symbol} / ${primary.code}`,
      secondaryText: `${secondary.symbol} / ${secondary.code}`,
      exchangeRate: hasRate ? Number(rate) : null,
      exchangeRateValue: rate,
      exchangeRateText: hasRate ? `T/C ${rate}` : 'T/C no configurado',
      hasExchangeRate: hasRate,
      updatedAt: updatedAtRaw,
      updatedAtText: hasRate ? formatDateTime(updatedAtRaw) : 'Sin registros',
      safeNote: hasRate ? 'Referencia monetaria leída desde Configuración → Moneda.' : 'T/C no configurado; no se inventan valores ni conversiones.'
    };
  }

  function formatMoney(value, currency){
    const c = String(currency || '').trim().toUpperCase();
    const symbol = (c === 'USD' || c === 'US$' || c === 'SECONDARY') ? SECONDARY.symbol : PRIMARY.symbol;
    if (global.A33Currency && typeof global.A33Currency.formatMoney === 'function'){
      try{ return global.A33Currency.formatMoney(value, c || 'NIO'); }catch(_){ }
    }
    return `${symbol}${formatNumber2(value)}`;
  }

  function buildMetadataRows(options = {}){
    const state = getState();
    const title = String(options.title || 'Referencia monetaria').trim() || 'Referencia monetaria';
    const rows = [
      [title, 'Suite A33'],
      ['Moneda principal', state.primaryText],
      ['Moneda secundaria', state.secondaryText],
      ['Tipo de cambio', state.exchangeRateText],
      ['Última actualización T/C', state.updatedAtText],
      ['Nota', state.safeNote]
    ];
    if (options.exportedAt){
      rows.splice(1, 0, ['Exportado', formatDateTime(options.exportedAt)]);
    }
    return rows;
  }

  function toJsonMeta(){
    const state = getState();
    return {
      source: 'Configuración → Moneda',
      primary: state.primary,
      secondary: state.secondary,
      primaryText: state.primaryText,
      secondaryText: state.secondaryText,
      hasExchangeRate: state.hasExchangeRate,
      exchangeRate: state.exchangeRateValue || '',
      exchangeRateText: state.exchangeRateText,
      updatedAt: state.updatedAt || '',
      updatedAtText: state.updatedAtText,
      note: state.safeNote,
      bridgeVersion: state.bridgeVersion,
      engineVersion: state.engineVersion
    };
  }

  function decorateJsonMeta(meta){
    const base = (meta && typeof meta === 'object') ? meta : {};
    return Object.assign({}, base, { currency: toJsonMeta() });
  }

  function appendWorkbookMetadataSheet(wb, XLSXRef, options = {}){
    try{
      const xlsx = XLSXRef || global.XLSX;
      if (!wb || !xlsx || !xlsx.utils || typeof xlsx.utils.aoa_to_sheet !== 'function' || typeof xlsx.utils.book_append_sheet !== 'function'){
        return false;
      }
      const rows = buildMetadataRows(options);
      const ws = xlsx.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 26 }, { wch: 72 }];
      const existing = new Set(Array.isArray(wb.SheetNames) ? wb.SheetNames : []);
      let name = String(options.sheetName || 'Moneda').trim() || 'Moneda';
      if (existing.has(name)){
        let i = 2;
        while (existing.has(`${name} ${i}`)) i += 1;
        name = `${name} ${i}`;
      }
      xlsx.utils.book_append_sheet(wb, ws, name);
      return true;
    }catch(_){
      return false;
    }
  }

  const api = Object.freeze({
    version: BRIDGE_VERSION,
    storageKey: STORAGE_KEY,
    getState,
    formatMoney,
    formatCordobas: (value) => formatMoney(value, 'NIO'),
    formatDollars: (value) => formatMoney(value, 'USD'),
    buildMetadataRows,
    toJsonMeta,
    decorateJsonMeta,
    appendWorkbookMetadataSheet,
    attachWorkbookMetadata: appendWorkbookMetadataSheet
  });

  global.A33ExportCurrency = api;
})(typeof window !== 'undefined' ? window : globalThis);
