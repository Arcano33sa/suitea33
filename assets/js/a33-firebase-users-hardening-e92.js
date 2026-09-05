/* Suite A33 — verificación local del blindaje administrativo E9.2. */
(function(g){
  'use strict';

  const SAFEGUARDS = [
    'workspace-canónico', 'admin-vigente', 'pertenencia-uid', 'último-admin',
    'bootstrap-exclusivo', 'contraseña-segura', 'archivo-previo-a-baja'
  ];

  function validate(input){
    const source = input && typeof input === 'object' ? input : {};
    const access = source.access && typeof source.access === 'object' ? source.access : {};
    const guardState = source.guardState && typeof source.guardState === 'object' ? source.guardState : {};
    const safeguards = Array.isArray(source.safeguards) ? source.safeguards : [];
    const issues = [];
    if (!guardState.enforcementEnabled) issues.push('La compuerta E8.4C no está activa.');
    if (!access.user || !access.profile || access.role !== 'admin' || access.profile.status !== 'active' || !access.isAdmin) issues.push('La sesión no confirma un Admin activo.');
    if (access.workspaceId !== 'arcano33') issues.push('El workspace activo no coincide con arcano33.');
    if (access.backendMode !== 'spark-manual' || access.managementReady !== false || access.canBootstrap !== false) issues.push('La administración privilegiada debe seguir desactivada.');
    if (safeguards.length !== SAFEGUARDS.length || SAFEGUARDS.some(function(item){ return !safeguards.includes(item); })) issues.push('El contrato local no declara los siete blindajes E9.2.');
    return {
      stage:'E9.2', readOnly:true, administrationEnabled:false,
      workspaceId:String(access.workspaceId || ''), safeguardCount:safeguards.length,
      guardActive:guardState.enforcementEnabled === true,
      issues:issues, completed:issues.length === 0
    };
  }

  async function run(){
    if (!g.A33Access || typeof g.A33Access.refresh !== 'function') throw new Error('No está disponible el acceso canónico.');
    if (!g.A33ModuleGuard || typeof g.A33ModuleGuard.getState !== 'function') throw new Error('No está disponible la guarda E8.4C.');
    const access = await g.A33Access.refresh();
    return validate({ access:access, guardState:g.A33ModuleGuard.getState(), safeguards:SAFEGUARDS.slice() });
  }

  g.A33UsersHardeningE92 = Object.assign({}, g.A33UsersHardeningE92 || {}, { validate:validate, run:run });
})(typeof globalThis !== 'undefined' ? globalThis : window);
