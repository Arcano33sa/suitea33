/* Suite A33 — compuerta de conexión administrativa E9.4A. */
(function(g){
  'use strict';

  function validate(access){
    const state = access && typeof access === 'object' ? access : {};
    const issues = [];
    if (state.backendMode !== 'functions') issues.push('El conector no usa el backend de Functions.');
    if (state.workspaceId !== 'arcano33') issues.push('El workspace no coincide con arcano33.');
    if (!state.user || !state.profile || state.role !== 'admin' || state.profile.status !== 'active' || !state.isAdmin) issues.push('La sesión no confirma un Admin activo.');
    const health = String(state.backendHealth || '');
    if (!['checking', 'missing', 'error', 'ready'].includes(health)) issues.push('El estado del backend no es reconocido.');
    if (state.managementReady && health !== 'ready') issues.push('La administración no puede activarse sin healthcheck correcto.');
    return {
      stage:'E9.4A', connectorPrepared:issues.length === 0,
      backendHealth:health, administrationEnabled:state.managementReady === true,
      safeFallback:state.managementReady !== true || health === 'ready', issues
    };
  }

  async function run(){
    if (!g.A33Access || typeof g.A33Access.refresh !== 'function') throw new Error('No está disponible el acceso canónico.');
    return validate(await g.A33Access.refresh());
  }

  g.A33UsersConnectE94A = Object.assign({}, g.A33UsersConnectE94A || {}, { validate, run });
})(typeof globalThis !== 'undefined' ? globalThis : window);
