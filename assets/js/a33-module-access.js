/* Suite A33 — traducción de permisos a módulos. E3 prepara; el bloqueo queda apagado hasta la activación final. */
(function(g){
  'use strict';
  const ENFORCEMENT_ENABLED = false;
  function accessApi(){ return g.A33Access && typeof g.A33Access.getState === 'function' ? g.A33Access : null; }
  function requiredPermission(moduleId){
    const api = accessApi();
    if (!api || typeof api.getModuleOptions !== 'function') return '';
    const target = String(moduleId || '').toLowerCase();
    const module = api.getModuleOptions().find(function(item){ return item.key === target; });
    return module ? module.permission : '';
  }
  function getState(){
    const access = g.A33Access && g.A33Access.getState ? g.A33Access.getState() : {};
    return { mode:'prepared-safety-gate', enforcementEnabled:ENFORCEMENT_ENABLED, recoveryPrepared:true, authenticated:!!access.user, role:access.role || '', permissions:Array.isArray(access.permissions) ? access.permissions.slice() : [] };
  }
  function canOpen(moduleId){
    const state = getState();
    if (!state.enforcementEnabled) return true;
    const api = accessApi();
    if (!api || typeof api.evaluateModuleAccess !== 'function') return false;
    return api.evaluateModuleAccess(moduleId, api.getState(), { enforcementEnabled:true }).allowed;
  }
  g.A33ModuleAccess = Object.assign({}, g.A33ModuleAccess || {}, { isEnabled:function(){ return ENFORCEMENT_ENABLED; }, canOpen, requiredPermission, getState });
})(typeof globalThis !== 'undefined' ? globalThis : window);
