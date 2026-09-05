/* Suite A33 — verificación local de activación E8.4C. */
(function(g){
  'use strict';

  const PAGES = [
    ['produccion','/calculadora/index.html'], ['lotes','/lotes/index.html'], ['inventario','/inventario/index.html'],
    ['pos','/pos/index.html'], ['analitica','/analitica/index.html'], ['pedidos','/pedidos/index.html'],
    ['finanzas','/finanzas/index.html'], ['catalogos','/catalogos/index.html'], ['agenda','/agenda/index.html'],
    ['centro-mando','/centro-mando/index.html'], ['configuracion','/configuracion/index.html'], ['temporal','/calculadora_temporal/index.html']
  ];

  function validate(input){
    const source = input && typeof input === 'object' ? input : {};
    const access = source.access && typeof source.access === 'object' ? source.access : {};
    const guardState = source.guardState && typeof source.guardState === 'object' ? source.guardState : {};
    const pages = Array.isArray(source.pages) ? source.pages : [];
    const roleMatrix = Array.isArray(source.roleMatrix) ? source.roleMatrix : [];
    const unknownResult = source.unknownResult && typeof source.unknownResult === 'object' ? source.unknownResult : {};
    const inactiveResult = source.inactiveResult && typeof source.inactiveResult === 'object' ? source.inactiveResult : {};
    const missing = pages.filter(function(page){ return !page.guardActive || !page.headerMatches; }).map(function(page){ return page.id; });
    const admin = roleMatrix.find(function(role){ return role.key === 'admin'; });
    const issues = [];

    if (!guardState.enforcementEnabled) issues.push('La compuerta real de módulos no está activa.');
    if (pages.length !== 12 || missing.length) issues.push('La activación no cubre las 12 páginas canónicas' + (missing.length ? ': ' + missing.join(', ') : '') + '.');
    if (!access.user || !access.profile || access.profile.status !== 'active' || access.role !== 'admin' || !access.isAdmin) issues.push('La sesión actual no confirma la recuperación del Admin Maestro.');
    if (roleMatrix.length !== 4) issues.push('La validación no cubrió los cuatro roles.');
    if (!admin || admin.allowedCount !== 12 || admin.deniedCount !== 0 || !admin.recoveryReady) issues.push('La recuperación Admin no cubre los 12 módulos.');
    if (roleMatrix.filter(function(role){ return role.key !== 'admin'; }).some(function(role){ return role.deniedCount < 1; })) issues.push('Algún rol limitado no conserva restricciones.');
    if (unknownResult.allowed !== false || unknownResult.reason !== 'module-unknown') issues.push('Una ruta desconocida no falla de forma segura.');
    if (inactiveResult.allowed !== false || inactiveResult.reason !== 'profile-unavailable') issues.push('Un perfil inactivo no queda bloqueado.');

    return {
      stage:'E8.4C', readOnly:true, activationAudit:true,
      pageCount:pages.length, activeGuardCount:pages.length - missing.length, missing:missing,
      roleCount:roleMatrix.length, moduleCount:12, checkCount:roleMatrix.length * 12 + 2,
      roleMatrix:roleMatrix, adminRecoveryReady:!!(admin && admin.recoveryReady),
      unknownRouteBlocked:unknownResult.allowed === false, inactiveProfileBlocked:inactiveResult.allowed === false,
      enforcementEnabled:!!guardState.enforcementEnabled, issues:issues, completed:issues.length === 0
    };
  }

  async function inspectPage(page){
    try{
      const response = await fetch(page[1], { cache:'no-store', credentials:'same-origin' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const html = await response.text();
      return { id:page[0], path:page[1], guardActive:/a33-module-guard\.js\?v=4\.20\.98(?:&amp;|&)r=2/.test(html), headerMatches:html.includes('data-a33-module="' + page[0] + '"') };
    }catch(error){
      return { id:page[0], path:page[1], guardActive:false, headerMatches:false, error:String(error && error.message || error) };
    }
  }

  async function run(){
    const accessApi = g.A33Access;
    const guardApi = g.A33ModuleGuard;
    if (!accessApi || typeof accessApi.refresh !== 'function' || typeof accessApi.getRoleOptions !== 'function') throw new Error('No está disponible la política central de Seguridad.');
    if (!guardApi || typeof guardApi.simulate !== 'function' || typeof guardApi.getState !== 'function') throw new Error('No está disponible la guarda común.');
    const access = await accessApi.refresh();
    const modules = accessApi.getModuleOptions();
    const roleMatrix = accessApi.getRoleOptions().map(function(role){
      const candidate = { user:{uid:'e84c-' + role.key}, profile:{role:role.key,status:'active'}, role:role.key, permissions:role.permissions.slice() };
      const results = modules.map(function(module){ return guardApi.simulate(module.key, candidate); });
      const allowedCount = results.filter(function(result){ return result.allowed; }).length;
      return { key:role.key, label:role.label, allowedCount:allowedCount, deniedCount:results.length - allowedCount, recoveryReady:role.key === 'admin' && results.every(function(result){ return result.allowed && result.reason === 'admin-recovery'; }) };
    });
    const pages = await Promise.all(PAGES.map(inspectPage));
    const unknownResult = guardApi.simulate('__unknown__', access);
    const inactiveResult = guardApi.simulate('analitica', { user:{uid:'inactive'}, profile:{role:'consulta',status:'inactive'}, role:'consulta', permissions:['reports.view'] });
    return validate({ access:access, guardState:guardApi.getState(), pages:pages, roleMatrix:roleMatrix, unknownResult:unknownResult, inactiveResult:inactiveResult });
  }

  g.A33SecurityActivationE84C = Object.assign({}, g.A33SecurityActivationE84C || {}, { validate:validate, run:run });
})(typeof globalThis !== 'undefined' ? globalThis : window);
