/* Suite A33 — prevalidación de la política de acceso E8.3 (sin activación). */
(function(g){
  'use strict';

  function clean(value, maxLen){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 240);
  }

  function prepare(input){
    const source = input && typeof input === 'object' ? input : {};
    const simulation = source.simulation && typeof source.simulation === 'object' ? source.simulation : {};
    const access = source.access && typeof source.access === 'object' ? source.access : {};
    const modules = Array.isArray(source.modules) ? source.modules : [];
    const navModules = Array.isArray(source.navModules) ? source.navModules : [];
    const moduleState = source.moduleState && typeof source.moduleState === 'object' ? source.moduleState : {};
    const policyIds = modules.map(function(item){ return clean(item.key, 80); }).filter(Boolean);
    const navIds = navModules.map(function(item){ return clean(item.id, 80); }).filter(Boolean);
    const missingPolicy = navIds.filter(function(id){ return !policyIds.includes(id); });
    const orphanPolicy = policyIds.filter(function(id){ return !navIds.includes(id); });
    const invalidPermissions = modules.filter(function(item){ return !clean(item.permission, 80); }).map(function(item){ return clean(item.key, 80); });
    const profile = access.profile && typeof access.profile === 'object' ? access.profile : null;
    const masterSafe = !!(access.user && profile && access.isAdmin && clean(profile.role, 40) === 'admin' && clean(profile.status, 30) === 'active');
    const recoveryResults = Array.isArray(source.recoveryResults) ? source.recoveryResults : [];
    const recoveryReady = masterSafe && recoveryResults.length === modules.length && recoveryResults.every(function(item){ return item && item.allowed === true && item.reason === 'admin-recovery'; });
    const issues = [];

    if (simulation.stage !== 'E8.2' || simulation.readyForE83 !== true) issues.push('E8.2 no está apta para preparar la política.');
    if (!modules.length || !navModules.length) issues.push('No está disponible el catálogo completo de módulos.');
    if (missingPolicy.length) issues.push('Hay módulos de navegación sin política: ' + missingPolicy.join(', ') + '.');
    if (orphanPolicy.length) issues.push('Hay políticas sin módulo canónico: ' + orphanPolicy.join(', ') + '.');
    if (invalidPermissions.length) issues.push('Hay módulos sin permiso definido: ' + invalidPermissions.join(', ') + '.');
    if (!recoveryReady) issues.push('La recuperación del Admin Maestro no cubre todos los módulos.');
    if (moduleState.enforcementEnabled) issues.push('La compuerta de acceso debe permanecer apagada durante E8.3.');

    return {
      stage:'E8.3',
      preparationOnly:true,
      readOnly:true,
      workspaceId:clean(access.workspaceId, 80) || 'arcano33',
      moduleCount:modules.length,
      navigationCount:navModules.length,
      missingPolicy:missingPolicy,
      orphanPolicy:orphanPolicy,
      invalidPermissions:invalidPermissions,
      masterSafe:masterSafe,
      recoveryReady:recoveryReady,
      enforcementEnabled:!!moduleState.enforcementEnabled,
      issues:issues,
      readyForE84:issues.length === 0
    };
  }

  async function run(){
    const simulationApi = g.A33SecuritySimulationE82;
    const accessApi = g.A33Access;
    const moduleApi = g.A33ModuleAccess;
    if (!simulationApi || typeof simulationApi.run !== 'function') throw new Error('Primero debe estar disponible E8.2.');
    if (!accessApi || typeof accessApi.getModuleOptions !== 'function' || typeof accessApi.evaluateModuleAccess !== 'function') throw new Error('No está disponible la política central de Seguridad.');
    if (!moduleApi || typeof moduleApi.getState !== 'function') throw new Error('No está disponible la compuerta de módulos.');
    const simulation = await simulationApi.run();
    const access = accessApi.getState();
    const modules = accessApi.getModuleOptions();
    const navModules = g.A33ModuleNav && Array.isArray(g.A33ModuleNav.modules) ? Array.from(g.A33ModuleNav.modules) : [];
    const recoveryResults = modules.map(function(module){ return accessApi.evaluateModuleAccess(module.key, access, { enforcementEnabled:true }); });
    return prepare({ simulation:simulation, access:access, modules:modules, navModules:navModules, moduleState:moduleApi.getState(), recoveryResults:recoveryResults });
  }

  g.A33SecurityPreparationE83 = Object.assign({}, g.A33SecurityPreparationE83 || {}, { prepare:prepare, run:run });
})(typeof globalThis !== 'undefined' ? globalThis : window);
