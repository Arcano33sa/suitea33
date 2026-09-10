/* Suite A33 — simulación local de accesos E8.2 (sin aplicación). */
(function(g){
  'use strict';

  function clean(value, maxLen){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 240);
  }

  function simulate(input){
    const source = input && typeof input === 'object' ? input : {};
    const diagnostic = source.diagnostic && typeof source.diagnostic === 'object' ? source.diagnostic : {};
    const access = source.access && typeof source.access === 'object' ? source.access : {};
    const roles = Array.isArray(source.roles) ? source.roles : [];
    const modules = Array.isArray(diagnostic.moduleMatrix) ? diagnostic.moduleMatrix : [];
    const roleMatrix = roles.map(function(role){
      const key = clean(role.key, 40);
      const allowed = modules.filter(function(module){ return Array.isArray(module.allowedRoles) && module.allowedRoles.includes(key); });
      return {
        key:key,
        label:clean(role.label, 80) || key,
        allowedCount:allowed.length,
        deniedCount:Math.max(0, modules.length - allowed.length),
        allowedModules:allowed.map(function(module){ return clean(module.label, 100); }),
        deniedModules:modules.filter(function(module){ return !allowed.includes(module); }).map(function(module){ return clean(module.label, 100); })
      };
    });
    const admin = roleMatrix.find(function(role){ return role.key === 'admin'; });
    const currentProfile = access.profile && typeof access.profile === 'object' ? access.profile : null;
    const masterSafe = !!(access.user && currentProfile && access.isAdmin && clean(currentProfile.role, 40) === 'admin' && clean(currentProfile.status, 30) === 'active');
    const enforcementEnabled = !!(source.moduleAccess && source.moduleAccess.enforcementEnabled);
    const issues = [];

    if (diagnostic.stage !== 'E8.1' || diagnostic.readyForE82 !== true) issues.push('E8.1 no está apta para la simulación.');
    if (!modules.length) issues.push('No hay módulos diagnosticados.');
    if (!admin || admin.allowedCount !== modules.length) issues.push('El rol Admin no conserva acceso a todos los módulos revisados.');
    if (!masterSafe) issues.push('La sesión actual no confirma un perfil Admin activo.');
    if (enforcementEnabled) issues.push('El bloqueo por módulos ya está activo y E8.2 exige una simulación sin aplicación.');

    return {
      stage:'E8.2',
      simulationOnly:true,
      readOnly:true,
      workspaceId:clean(diagnostic.workspaceId || access.workspaceId, 80) || 'arcano33',
      roleCount:roleMatrix.length,
      moduleCount:modules.length,
      roleMatrix:roleMatrix,
      masterSafe:masterSafe,
      adminFullAccess:!!(admin && admin.allowedCount === modules.length),
      enforcementEnabled:enforcementEnabled,
      issues:issues,
      readyForE83:issues.length === 0
    };
  }

  async function run(){
    const diagnosticApi = g.A33SecurityDiagnosticE81;
    const accessApi = g.A33Access;
    if (!diagnosticApi || typeof diagnosticApi.run !== 'function') throw new Error('Primero debe estar disponible E8.1.');
    if (!accessApi || typeof accessApi.getState !== 'function' || typeof accessApi.getRoleOptions !== 'function') throw new Error('No está disponible el acceso de Seguridad.');
    const diagnostic = await diagnosticApi.run();
    const access = accessApi.getState();
    const moduleState = g.A33ModuleAccess && typeof g.A33ModuleAccess.getState === 'function'
      ? g.A33ModuleAccess.getState()
      : { enforcementEnabled:false };
    return simulate({ diagnostic:diagnostic, access:access, roles:accessApi.getRoleOptions(), moduleAccess:moduleState });
  }

  g.A33SecuritySimulationE82 = Object.assign({}, g.A33SecuritySimulationE82 || {}, { simulate:simulate, run:run });
})(typeof globalThis !== 'undefined' ? globalThis : window);
