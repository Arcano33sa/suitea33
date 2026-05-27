/* Suite A33 — Module Access placeholder local-first. No bloquea módulos. */
(function(g){
  'use strict';
  g.A33ModuleAccess = Object.assign({}, g.A33ModuleAccess || {}, {
    isEnabled: function(){ return true; },
    canOpen: function(){ return true; },
    getState: function(){ return { mode: 'local-first', enabled: true }; }
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
