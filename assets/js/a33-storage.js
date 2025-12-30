/*
  Suite A33 — A33Storage (core)
  Servicio único para acceso a Storage (local/session).

  - Centraliza get/set/remove/keys
  - Helpers JSON y updateJSON
  - Borrado por prefijos (solo Suite A33)
*/

(function(){
  'use strict';

  const DEFAULT_PREFIXES = ['arcano33_', 'a33_', 'suite_a33_'];

  function isString(x){ return typeof x === 'string'; }
  function safeJsonParse(str){
    if (!isString(str) || str === '') return null;
    try{ return JSON.parse(str); }catch(_){ return null; }
  }

  function getStore(scope){
    return scope === 'session' ? window.sessionStorage : window.localStorage;
  }

  function matchPrefixes(key, prefixes){
    const list = Array.isArray(prefixes) && prefixes.length ? prefixes : DEFAULT_PREFIXES;
    return list.some(p => key.startsWith(p));
  }

  const A33Storage = {
    // Exponer prefijos usados por la Suite
    prefixes: DEFAULT_PREFIXES.slice(),

    // API estilo Storage (string)
    getItem(key, scope='local'){
      try{ return getStore(scope).getItem(key); }catch(_){ return null; }
    },
    setItem(key, value, scope='local'){
      try{ getStore(scope).setItem(key, String(value ?? '')); return true; }catch(_){ return false; }
    },
    removeItem(key, scope='local'){
      try{ getStore(scope).removeItem(key); return true; }catch(_){ return false; }
    },

    // Helpers raw
    getRaw(key, fallback=null, scope='local'){
      const v = this.getItem(key, scope);
      return (v == null) ? fallback : v;
    },
    setRaw(key, value, scope='local'){
      return this.setItem(key, value, scope);
    },

    // Helpers JSON
    getJSON(key, fallback=null, scope='local'){
      const raw = this.getItem(key, scope);
      if (raw == null) return fallback;
      const obj = safeJsonParse(raw);
      return (obj == null) ? fallback : obj;
    },
    setJSON(key, obj, scope='local'){
      try{ return this.setItem(key, JSON.stringify(obj ?? null), scope); }catch(_){ return false; }
    },

    // Update JSON sin “dedazos” (lee, aplica función, escribe)
    updateJSON(key, updater, { scope='local', defaultValue=null } = {}){
      const cur = this.getJSON(key, defaultValue, scope);
      const next = updater(cur);
      this.setJSON(key, next, scope);
      return next;
    },

    // keys('local'|'session') o keys({ scope: 'local'|'session' })
    keys(scopeOrOpts='local'){
      let scope = 'local';
      if (scopeOrOpts && typeof scopeOrOpts === 'object'){
        scope = scopeOrOpts.scope === 'session' ? 'session' : 'local';
      } else {
        scope = scopeOrOpts === 'session' ? 'session' : 'local';
      }
      const store = getStore(scope);
      const out = [];
      try{
        for (let i = 0; i < store.length; i++){
          const k = store.key(i);
          if (k != null) out.push(k);
        }
      }catch(_){ }
      return out;
    },

    // Solo borra claves A33 (por prefijos)
    clearA33({ scope='local', prefixes } = {}){
      const store = getStore(scope);
      const ks = this.keys(scope).filter(k => matchPrefixes(k, prefixes));
      ks.forEach(k => { try{ store.removeItem(k); }catch(_){ } });
      return ks.length;
    },

    // Snapshot para export (solo claves A33 por prefijos)
    snapshotA33({ scope='local', prefixes } = {}){
      const store = getStore(scope);
      const out = {};
      this.keys(scope).forEach(k => {
        if (!matchPrefixes(k, prefixes)) return;
        try{ out[k] = store.getItem(k); }catch(_){ }
      });
      return out;
    }
  };

  // Global
  window.A33Storage = A33Storage;
})();
