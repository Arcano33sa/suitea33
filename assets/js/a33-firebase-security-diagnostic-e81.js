/* Suite A33 — diagnóstico de seguridad E8.1 (solo lectura). */
(function(g){
  'use strict';

  const MODULES = [
    ['configuracion', 'Configuración', 'config.view'],
    ['pos', 'POS y ventas', 'sales.use'],
    ['agenda', 'Agenda', 'agenda.use'],
    ['finanzas', 'Finanzas', 'finance.use'],
    ['inventario', 'Inventario', 'inventory.use'],
    ['produccion', 'Producción', 'production.use'],
    ['lotes', 'Lotes', 'lots.use'],
    ['pedidos', 'Pedidos', 'pedidos.use'],
    ['centro-mando', 'Centro de mando', 'center.view'],
    ['catalogos', 'Catálogos', 'catalog.view']
  ];

  function clean(value, maxLen){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 240);
  }

  function cloneRoles(api){
    if (!api || typeof api.getRoleOptions !== 'function') return [];
    return api.getRoleOptions().map(function(role){
      return {
        key:clean(role.key, 40),
        label:clean(role.label, 80),
        permissions:Array.isArray(role.permissions) ? role.permissions.map(function(item){ return clean(item, 80); }).filter(Boolean) : []
      };
    });
  }

  function normalizeUser(user){
    const src = user && typeof user === 'object' ? user : {};
    return {
      uid:clean(src.uid || src.id, 160),
      workspaceId:clean(src.workspaceId, 80),
      name:clean(src.name, 160),
      email:clean(src.email, 180).toLowerCase(),
      role:clean(src.role, 40),
      status:clean(src.status, 30),
      permissions:Array.isArray(src.permissions) ? src.permissions.map(function(item){ return clean(item, 80); }).filter(Boolean) : []
    };
  }

  function diagnose(input){
    const source = input && typeof input === 'object' ? input : {};
    const access = source.access && typeof source.access === 'object' ? source.access : {};
    const workspaceId = clean(access.workspaceId, 80) || 'arcano33';
    const roles = Array.isArray(source.roles) ? source.roles : [];
    const roleMap = new Map(roles.map(function(role){ return [clean(role.key, 40), role]; }));
    const users = (Array.isArray(source.users) ? source.users : []).map(normalizeUser).filter(function(user){ return user.uid || user.email; });
    const issues = [];
    const warnings = [];

    if (!access.user) issues.push({ code:'session-missing', message:'No hay una sesión autenticada en Firebase.' });
    if (access.user && !access.profile) issues.push({ code:'profile-missing', message:'La sesión no tiene un perfil canónico en Firestore.' });
    if (access.profile && clean(access.profile.status, 30) !== 'active') issues.push({ code:'profile-inactive', message:'El perfil de la sesión no está activo.' });
    if (access.profile && clean(access.profile.workspaceId, 80) && clean(access.profile.workspaceId, 80) !== workspaceId){
      issues.push({ code:'workspace-mismatch', message:'El perfil de la sesión pertenece a otro workspace.' });
    }

    users.forEach(function(user){
      if (!user.uid) issues.push({ code:'uid-missing', message:'Un perfil no tiene UID canónico.' });
      if (!user.email) warnings.push({ code:'email-missing', message:'Un perfil no tiene correo normalizado.' });
      if (!roleMap.has(user.role)) issues.push({ code:'role-unknown', message:'El perfil ' + (user.email || user.uid || 'sin identificar') + ' usa un rol desconocido.' });
      if (user.status !== 'active' && user.status !== 'inactive') issues.push({ code:'status-invalid', message:'El perfil ' + (user.email || user.uid || 'sin identificar') + ' tiene un estado inválido.' });
      if (user.workspaceId && user.workspaceId !== workspaceId) issues.push({ code:'member-workspace-mismatch', message:'El perfil ' + (user.email || user.uid || 'sin identificar') + ' pertenece a otro workspace.' });
    });

    const activeAdmins = users.filter(function(user){ return user.role === 'admin' && user.status === 'active'; });
    if (!activeAdmins.length) issues.push({ code:'active-admin-missing', message:'No se encontró un Admin activo en los perfiles visibles.' });
    if (activeAdmins.length === 1) warnings.push({ code:'single-admin', message:'Existe un solo Admin activo; debe conservarse como vía de recuperación.' });

    const moduleMatrix = MODULES.map(function(module){
      return {
        id:module[0],
        label:module[1],
        permission:module[2],
        allowedRoles:roles.filter(function(role){ return Array.isArray(role.permissions) && role.permissions.includes(module[2]); }).map(function(role){ return role.key; })
      };
    });
    moduleMatrix.forEach(function(module){
      if (!module.allowedRoles.length) warnings.push({ code:'module-unassigned', message:'Ningún rol conocido tiene el permiso ' + module.permission + '.' });
    });

    const enforcementEnabled = !!(source.moduleAccess && source.moduleAccess.enforcementEnabled);
    const limitedScope = !!access.user && !access.isAdmin;
    if (limitedScope) warnings.push({ code:'limited-scope', message:'La sesión no es Admin; el diagnóstico solo pudo revisar su propio perfil.' });

    return {
      stage:'E8.1',
      readOnly:true,
      workspaceId:workspaceId,
      userCount:users.length,
      activeCount:users.filter(function(user){ return user.status === 'active'; }).length,
      inactiveCount:users.filter(function(user){ return user.status === 'inactive'; }).length,
      activeAdminCount:activeAdmins.length,
      roleCount:roles.length,
      moduleCount:moduleMatrix.length,
      moduleMatrix:moduleMatrix,
      issues:issues,
      warnings:warnings,
      enforcementEnabled:enforcementEnabled,
      readyForE82:issues.length === 0 && !enforcementEnabled,
      limitedScope:limitedScope
    };
  }

  async function run(){
    const accessApi = g.A33Access;
    if (!accessApi || typeof accessApi.getState !== 'function' || typeof accessApi.listUsers !== 'function'){
      throw new Error('No está disponible el acceso de Seguridad.');
    }
    const access = accessApi.getState();
    const users = await accessApi.listUsers();
    const moduleState = g.A33ModuleAccess && typeof g.A33ModuleAccess.getState === 'function'
      ? g.A33ModuleAccess.getState()
      : { enforcementEnabled:false };
    return diagnose({ access:access, users:users, roles:cloneRoles(accessApi), moduleAccess:moduleState });
  }

  g.A33SecurityDiagnosticE81 = Object.assign({}, g.A33SecurityDiagnosticE81 || {}, {
    diagnose:diagnose,
    run:run,
    modules:function(){ return MODULES.map(function(item){ return item.slice(); }); }
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
