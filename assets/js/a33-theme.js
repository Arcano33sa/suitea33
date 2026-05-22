/* Suite A33 — Apariencia global compartida
   Etapa 3/5: puente seguro para componentes generales.
   No toca logica de negocio; solo resuelve dark/light/auto y expone helpers.
*/
(function(g){
  'use strict';

  var KEY = 'suite_a33_appearance_preference';
  var valid = { dark:true, light:true, auto:true };
  var mediaQuery = null;

  function normalize(value){
    var v = String(value || '').trim().toLowerCase();
    return valid[v] ? v : 'dark';
  }

  function systemTheme(){
    try{
      return (g.matchMedia && g.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }catch(_){
      return 'dark';
    }
  }

  function resolve(preference){
    var pref = normalize(preference);
    return pref === 'auto' ? systemTheme() : pref;
  }

  function read(){
    try{ return normalize(g.localStorage && g.localStorage.getItem(KEY)); }
    catch(_){ return 'dark'; }
  }

  function setMeta(resolved){
    try{
      if (!g.document) return;
      var meta = g.document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolved === 'light' ? '#f4ead8' : '#060606');
    }catch(_){ }
  }

  function apply(preference){
    var pref = normalize(preference || read());
    var resolved = resolve(pref);
    try{
      if (g.document && g.document.documentElement){
        g.document.documentElement.setAttribute('data-a33-theme-preference', pref);
        g.document.documentElement.setAttribute('data-theme', resolved);
      }
      if (g.document && g.document.body){
        g.document.body.setAttribute('data-a33-theme-preference', pref);
        g.document.body.setAttribute('data-theme', resolved);
      }
      setMeta(resolved);
    }catch(_){ }
    return { preference: pref, resolved: resolved };
  }

  function write(preference){
    var pref = normalize(preference);
    try{ g.localStorage && g.localStorage.setItem(KEY, pref); }catch(_){ }
    return apply(pref);
  }

  function bind(){
    try{
      if (!g.matchMedia || mediaQuery) return;
      mediaQuery = g.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function(){ if (read() === 'auto') apply('auto'); };
      if (typeof mediaQuery.addEventListener === 'function') mediaQuery.addEventListener('change', onChange);
      else if (typeof mediaQuery.addListener === 'function') mediaQuery.addListener(onChange);
    }catch(_){ }
  }

  try{
    g.A33Theme = Object.assign({}, g.A33Theme || {}, {
      key: KEY,
      read: read,
      write: write,
      apply: apply,
      resolve: resolve,
      getPreference: read,
      getResolvedTheme: function(){ return resolve(read()); }
    });
  }catch(_){ }

  try{
    g.addEventListener('storage', function(event){
      if (!event || event.key === KEY) apply(read());
    });
  }catch(_){ }

  apply(read());

  if (g.document){
    if (g.document.readyState === 'loading'){
      g.document.addEventListener('DOMContentLoaded', function(){ apply(read()); bind(); }, { once:true });
    }else{
      apply(read());
      bind();
    }
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
