/* Suite A33 — diagnóstico de solo lectura del backend administrativo E9.1. */
(function(g){
  'use strict';

  function validate(input){
    const source = input && typeof input === 'object' ? input : {};
    const access = source.access && typeof source.access === 'object' ? source.access : {};
    const profiles = Array.isArray(source.profiles) ? source.profiles : [];
    const contracts = source.contracts && typeof source.contracts === 'object' ? source.contracts : {};
    const guardState = source.guardState && typeof source.guardState === 'object' ? source.guardState : {};
    const contractNames = ['saveUser', 'deleteUser', 'bootstrapAdmin'];
    const availableContracts = contractNames.filter(function(name){ return contracts[name] === true; });
    const activeAdmins = profiles.filter(function(profile){ return profile && profile.role === 'admin' && profile.status === 'active'; }).length;
    const issues = [];

    if (!guardState.enforcementEnabled) issues.push('E8.4C no confirma la compuerta activa.');
    if (!access.user || !access.profile || access.profile.status !== 'active' || access.role !== 'admin' || !access.isAdmin) issues.push('La sesión actual no corresponde a un Admin activo.');
    if (access.backendMode !== 'spark-manual') issues.push('El backend no está en el modo Spark/manual esperado para el diagnóstico.');
    if (access.managementReady !== false || access.canBootstrap !== false) issues.push('La administración privilegiada debe permanecer desactivada durante E9.1.');
    if (availableContracts.length !== contractNames.length) issues.push('Falta uno o más contratos administrativos locales.');
    if (!profiles.length) issues.push('No se pudo leer ningún perfil del workspace.');
    if (profiles.length && activeAdmins < 1) issues.push('No existe un Admin activo visible para recuperación.');

    return {
      stage:'E9.1', readOnly:true, administrationEnabled:false,
      workspaceId:String(access.workspaceId || ''), backendMode:String(access.backendMode || ''),
      profileCount:profiles.length, activeAdminCount:activeAdmins,
      contractCount:availableContracts.length, expectedContractCount:contractNames.length,
      guardActive:guardState.enforcementEnabled === true,
      issues:issues, completed:issues.length === 0
    };
  }

  async function run(){
    const accessApi = g.A33Access;
    const guardApi = g.A33ModuleGuard;
    if (!accessApi || typeof accessApi.refresh !== 'function' || typeof accessApi.listUsers !== 'function') throw new Error('No está disponible el acceso canónico de Seguridad.');
    if (!guardApi || typeof guardApi.getState !== 'function') throw new Error('No está disponible la guarda común E8.4C.');
    const access = await accessApi.refresh();
    const profiles = await accessApi.listUsers();
    return validate({
      access:access,
      profiles:profiles,
      guardState:guardApi.getState(),
      contracts:{
        saveUser:typeof accessApi.saveUser === 'function',
        deleteUser:typeof accessApi.deleteUser === 'function',
        bootstrapAdmin:typeof accessApi.bootstrapAdmin === 'function'
      }
    });
  }

  g.A33UsersDiagnosticE91 = Object.assign({}, g.A33UsersDiagnosticE91 || {}, { validate:validate, run:run });
})(typeof globalThis !== 'undefined' ? globalThis : window);
