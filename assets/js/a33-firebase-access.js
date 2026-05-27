/* Suite A33 — Access placeholder local-first. Seguridad real queda para etapa posterior. */
(function(g){
  'use strict';

  const roleOptions = [
    { key: 'admin', label: 'Admin', description: 'Administración completa', permissions: [] },
    { key: 'ventas', label: 'Ventas', description: 'Operación de ventas', permissions: [] },
    { key: 'finanzas', label: 'Finanzas', description: 'Operación financiera', permissions: [] },
    { key: 'consulta', label: 'Consulta', description: 'Lectura/consulta', permissions: [] }
  ];

  function getState(){
    return {
      user: null,
      profile: null,
      workspaceId: 'arcano33',
      role: '',
      roleLabel: 'Sin rol',
      statusLabel: 'Sin estado',
      backendHealth: 'idle',
      managementReady: false,
      canBootstrap: false,
      loadingProfile: false,
      isAdmin: false
    };
  }

  g.A33Access = Object.assign({}, g.A33Access || {}, {
    getState,
    getRoleOptions: function(){ return roleOptions.slice(); },
    listUsers: function(){ return Promise.resolve([]); },
    saveUser: function(){ return Promise.reject(new Error('Gestión de usuarios no está activa en esta etapa.')); },
    deleteUser: function(){ return Promise.reject(new Error('Gestión de usuarios no está activa en esta etapa.')); },
    bootstrapAdmin: function(){ return Promise.reject(new Error('Backend admin no está activo en esta etapa.')); }
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
