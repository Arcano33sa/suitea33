/* Suite A33 — prueba controlada de guardas E8.4B (sin activación real). */
(function(g){
  'use strict';

  function clean(value, maxLen){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 120);
  }

  function validate(input){
    const source = input && typeof input === 'object' ? input : {};
    const installation = source.installation && typeof source.installation === 'object' ? source.installation : {};
    const roles = Array.isArray(source.roles) ? source.roles : [];
    const moduleCount = Number(source.moduleCount) || 0;
    const guardState = source.guardState && typeof source.guardState === 'object' ? source.guardState : {};
    const unknownResult = source.unknownResult && typeof source.unknownResult === 'object' ? source.unknownResult : {};
    const inactiveResult = source.inactiveResult && typeof source.inactiveResult === 'object' ? source.inactiveResult : {};
    const admin = roles.find(function(role){ return role.key === 'admin'; });
    const nonAdmins = roles.filter(function(role){ return role.key !== 'admin'; });
    const issues = [];

    if (installation.stage !== 'E8.4A' || installation.readyForE84B !== true) issues.push('E8.4A no está confirmada para probar las guardas.');
    if (guardState.enforcementEnabled) issues.push('La compuerta real se activó durante la prueba controlada.');
    if (moduleCount !== 12) issues.push('La prueba no cubrió los 12 módulos canónicos.');
    if (roles.length !== 4) issues.push('La prueba no cubrió los 4 roles canónicos.');
    if (!admin || admin.allowedCount !== moduleCount || admin.deniedCount !== 0 || !admin.recoveryReady) issues.push('El Admin Maestro no conserva recuperación completa.');
    if (nonAdmins.some(function(role){ return role.allowedCount + role.deniedCount !== moduleCount; })) issues.push('Hay roles con cobertura incompleta.');
    if (nonAdmins.some(function(role){ return role.deniedCount === 0; })) issues.push('La prueba no confirmó restricciones para todos los roles limitados.');
    if (unknownResult.allowed !== false || unknownResult.reason !== 'module-unknown') issues.push('Una ruta desconocida no falla de forma segura.');
    if (inactiveResult.allowed !== false || inactiveResult.reason !== 'profile-unavailable') issues.push('Un perfil inactivo no queda restringido en la simulación.');

    return {
      stage:'E8.4B', simulationOnly:true, readOnly:true,
      roleCount:roles.length, moduleCount:moduleCount, checkCount:roles.length * moduleCount + 2,
      roleMatrix:roles, adminRecoveryReady:!!(admin && admin.recoveryReady),
      unknownRouteBlocked:unknownResult.allowed === false, inactiveProfileBlocked:inactiveResult.allowed === false,
      enforcementEnabled:!!guardState.enforcementEnabled, issues:issues, readyForE84C:issues.length === 0
    };
  }

  async function run(){
    const installationApi = g.A33SecurityGuardsE84A;
    const accessApi = g.A33Access;
    const guardApi = g.A33ModuleGuard;
    if (!installationApi || typeof installationApi.run !== 'function') throw new Error('Primero debe estar disponible E8.4A.');
    if (!accessApi || typeof accessApi.getRoleOptions !== 'function' || typeof accessApi.getModuleOptions !== 'function') throw new Error('No está disponible el catálogo central de acceso.');
    if (!guardApi || typeof guardApi.simulate !== 'function' || typeof guardApi.getState !== 'function') throw new Error('No está disponible la guarda común para la prueba.');
    const installation = await installationApi.run();
    const modules = accessApi.getModuleOptions();
    const roles = accessApi.getRoleOptions().map(function(role){
      const access = { user:{ uid:'e84b-' + role.key }, profile:{ role:role.key, status:'active' }, role:role.key, permissions:role.permissions.slice(), isAdmin:role.key === 'admin' };
      const results = modules.map(function(module){ return guardApi.simulate(module.key, access); });
      const allowed = results.filter(function(result){ return result.allowed; });
      return {
        key:clean(role.key, 40), label:clean(role.label, 80),
        allowedCount:allowed.length, deniedCount:results.length - allowed.length,
        allowedModules:modules.filter(function(_, index){ return results[index].allowed; }).map(function(module){ return module.key; }),
        deniedModules:modules.filter(function(_, index){ return !results[index].allowed; }).map(function(module){ return module.key; }),
        recoveryReady:role.key === 'admin' && results.every(function(result){ return result.allowed && result.reason === 'admin-recovery'; })
      };
    });
    const unknownResult = guardApi.simulate('__unknown__', { user:{uid:'master'}, profile:{role:'admin',status:'active'}, role:'admin', permissions:[] });
    const inactiveResult = guardApi.simulate('analitica', { user:{uid:'inactive'}, profile:{role:'consulta',status:'inactive'}, role:'consulta', permissions:['reports.view'] });
    return validate({ installation:installation, roles:roles, moduleCount:modules.length, guardState:guardApi.getState(), unknownResult:unknownResult, inactiveResult:inactiveResult });
  }

  g.A33SecurityTestE84B = Object.assign({}, g.A33SecurityTestE84B || {}, { validate:validate, run:run });
})(typeof globalThis !== 'undefined' ? globalThis : window);
