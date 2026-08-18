/* Suite A33 — traducción de permisos a módulos. E3 prepara; el bloqueo queda apagado hasta la activación final. */
(function(g){
  'use strict';
  const permissions = { configuracion:'config.view', catalogos:'catalog.view', inventario:'inventory.use', lotes:'lots.use', pos:'sales.use', pedidos:'pedidos.use', agenda:'agenda.use', finanzas:'finance.use', analitica:'reports.view', 'centro-mando':'center.view', calculadora:'production.use' };
  function getState(){
    const access = g.A33Access && g.A33Access.getState ? g.A33Access.getState() : {};
    return { mode:'prepared-not-enforced', enforcementEnabled:false, authenticated:!!access.user, role:access.role || '', permissions:Array.isArray(access.permissions) ? access.permissions.slice() : [] };
  }
  function canOpen(moduleId){
    const state = getState();
    if (!state.enforcementEnabled) return true;
    const required = permissions[String(moduleId || '').toLowerCase()];
    return !required || state.permissions.includes(required);
  }
  g.A33ModuleAccess = Object.assign({}, g.A33ModuleAccess || {}, { isEnabled:function(){ return false; }, canOpen, requiredPermission:function(moduleId){ return permissions[String(moduleId || '').toLowerCase()] || ''; }, getState });
})(typeof globalThis !== 'undefined' ? globalThis : window);
