/* Suite A33 — Firebase Auth placeholder. No Google Sign-In, no email auth en esta etapa. */
(function(g){
  'use strict';
  const state = { ready: false, user: null, mode: 'local-first' };
  g.A33FirebaseAuth = Object.assign({}, g.A33FirebaseAuth || {}, {
    getState: function(){ return Object.assign({}, state); },
    getCurrentUser: function(){ return null; },
    signIn: function(){ return Promise.reject(new Error('Firebase Auth no está activo en esta etapa.')); },
    signOut: function(){ return Promise.resolve({ ok: true, mode: 'local-first' }); }
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
