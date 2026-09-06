/* Suite A33 — perfiles, roles y administración segura de Firebase (E3). */
(function(g){
  'use strict';

  const SDK_VERSION = '10.12.5';
  const REGION = 'us-central1';
  const BACKEND_MODE = 'functions';
  const scripts = {
    firestore:['a33-firebase-sdk-firestore-compat', 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-firestore-compat.js'],
    functions:['a33-firebase-sdk-functions-compat', 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-functions-compat.js']
  };
  const roleOptions = [
    { key:'admin', label:'Admin', description:'Administración completa', permissions:['suite.use','config.view','users.view','users.manage','roles.assign','backup.manage','firebase.admin','sales.use','agenda.use','finance.use','purchases.use','reports.view','inventory.use','production.use','lots.use','pedidos.use','center.view','sandbox.use','catalog.view'] },
    { key:'ventas', label:'Ventas', description:'Ventas, clientes y operación comercial', permissions:['suite.use','sales.use','agenda.use','customers.view','inventory.use','production.use','lots.use','pedidos.use','center.view','reports.view','catalog.view'] },
    { key:'finanzas', label:'Finanzas', description:'Finanzas, compras e informes', permissions:['suite.use','finance.use','purchases.use','reports.view','center.view','catalog.view'] },
    { key:'consulta', label:'Consulta', description:'Consulta de informes, centro y catálogos', permissions:['suite.use','reports.view','center.view','catalog.view'] }
  ];
  const moduleOptions = [
    { key:'produccion', label:'Producción', permission:'production.use' },
    { key:'lotes', label:'Lotes', permission:'lots.use' },
    { key:'inventario', label:'Inventario', permission:'inventory.use' },
    { key:'pos', label:'POS', permission:'sales.use' },
    { key:'analitica', label:'Analítica', permission:'reports.view' },
    { key:'pedidos', label:'Pedidos', permission:'pedidos.use' },
    { key:'finanzas', label:'Finanzas', permission:'finance.use' },
    { key:'catalogos', label:'Catálogos', permission:'catalog.view' },
    { key:'agenda', label:'Agenda', permission:'agenda.use' },
    { key:'centro-mando', label:'Centro de mando', permission:'center.view' },
    { key:'configuracion', label:'Configuración', permission:'config.view' },
    { key:'temporal', label:'Temporal', permission:'sandbox.use' }
  ];
  let firestore = null;
  let functions = null;
  let initPromise = null;
  let state = baseState();

  function baseState(){ return { user:null, profile:null, workspaceId:'arcano33', role:'', roleLabel:'Sin rol', statusLabel:'Sin estado', permissions:[], backendMode:BACKEND_MODE, backendHealth:'checking', backendMessage:'Verificando el backend administrativo…', managementReady:false, canBootstrap:false, loadingProfile:false, profileMissing:false, isAdmin:false }; }
  function clean(value, maxLen){ return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 320); }
  function workspaceId(){ try{ return clean(g.A33FirebaseSettings.read().workspaceId, 80) || 'arcano33'; }catch(_){ return 'arcano33'; } }
  function roleMeta(role){ return roleOptions.find(function(item){ return item.key === role; }) || null; }
  function getState(){ return Object.assign({}, state, { user:state.user ? Object.assign({}, state.user) : null, profile:state.profile ? Object.assign({}, state.profile) : null, permissions:state.permissions.slice() }); }
  function dispatch(){ try{ if (typeof g.CustomEvent === 'function' && g.dispatchEvent) g.dispatchEvent(new CustomEvent('a33:access-state', { detail:getState() })); }catch(_){ } }
  function setState(patch){ state = Object.assign({}, state, patch || {}); dispatch(); return getState(); }

  function loadScript(id, src){
    return new Promise(function(resolve, reject){
      const method = id.includes('firestore') ? 'firestore' : 'functions';
      if (g.firebase && typeof g.firebase[method] === 'function') return resolve();
      if (typeof document === 'undefined') return reject(new Error('Firebase requiere un navegador.'));
      const current = document.getElementById(id);
      if (current){ current.addEventListener('load', resolve, { once:true }); current.addEventListener('error', function(){ reject(new Error('No se pudo cargar ' + method + '.')); }, { once:true }); return; }
      const script = document.createElement('script');
      script.id=id; script.src=src; script.async=true; script.crossOrigin='anonymous'; script.onload=resolve; script.onerror=function(){ reject(new Error('No se pudo cargar ' + method + '.')); };
      (document.head || document.documentElement).appendChild(script);
    });
  }
  function timestamp(value){
    if (!value) return '';
    try{ if (typeof value.toDate === 'function') return value.toDate().toISOString(); }catch(_){ }
    return clean(value, 80);
  }
  function normalizeProfile(data, uid){
    const src = data && typeof data === 'object' ? data : {};
    const role = roleMeta(clean(src.role, 30)) ? clean(src.role, 30) : 'consulta';
    return { uid:clean(src.uid || uid, 160), workspaceId:clean(src.workspaceId || workspaceId(), 80), name:clean(src.name, 160), email:clean(src.email, 180).toLowerCase(), role, status:src.status === 'active' ? 'active' : 'inactive', permissions:Array.isArray(src.permissions) ? src.permissions.map(function(item){ return clean(item, 80); }).filter(Boolean) : roleMeta(role).permissions.slice(), createdAt:timestamp(src.createdAt), updatedAt:timestamp(src.updatedAt), lastAdminMutationAt:timestamp(src.lastAdminMutationAt) };
  }
  async function ensureFirestore(){
    const settings = g.A33FirebaseSettings && g.A33FirebaseSettings.read ? g.A33FirebaseSettings.read() : null;
    if (!settings || !settings.enabled || !g.A33Firebase || !g.A33Firebase.isFirebaseConfigured(settings)) throw new Error('Firebase debe estar configurado y activado antes de usar Seguridad.');
    const app = await g.A33Firebase.initFirebaseApp(settings);
    await loadScript(scripts.firestore[0], scripts.firestore[1]);
    firestore = g.firebase.firestore(app);
    return { app, firestore };
  }
  async function ensureAdminServices(){
    const services = await ensureFirestore();
    await loadScript(scripts.functions[0], scripts.functions[1]);
    const app = services.app;
    functions = g.firebase.app(app.name).functions(REGION);
    return { firestore, functions };
  }
  async function call(name, data){
    await ensureAdminServices();
    const result = await functions.httpsCallable(name)(data || {});
    return result && result.data ? result.data : {};
  }
  async function readTokenClaims(){
    const nativeUser = g.A33FirebaseAuth && g.A33FirebaseAuth.getNativeUser ? g.A33FirebaseAuth.getNativeUser() : null;
    if (!nativeUser || typeof nativeUser.getIdTokenResult !== 'function') return {};
    const result = await nativeUser.getIdTokenResult(false);
    return result && result.claims && typeof result.claims === 'object' ? result.claims : {};
  }
  function backendFailureState(error){
    const code = clean(error && error.code, 120).toLowerCase();
    const missing = code.includes('not-found') || code.includes('unimplemented');
    return {
      backendHealth:missing ? 'missing' : 'error', managementReady:false, canBootstrap:false,
      backendMessage:missing ? 'Functions administrativas aún no están desplegadas.' : (clean(error && error.message, 300) || 'No se pudo verificar el backend administrativo.')
    };
  }
  async function verifyBackend({ workspaceId:ws, isAdmin, active }){
    try{
      const result = await call('a33AdminHealthcheck', { workspaceId:ws });
      if (!result || result.ok !== true || result.workspaceId !== ws) throw new Error('El healthcheck no confirmó el workspace activo.');
      const claims = await readTokenClaims();
      const claimsReady = claims.workspaceId === ws && claims.role === 'admin' && claims.status === 'active';
      const managementReady = !!(result.workspaceReady && isAdmin && active && claimsReady);
      return {
        backendHealth:'ready', managementReady,
        canBootstrap:!!(result.currentUserCanBootstrap && active && isAdmin),
        backendMessage:managementReady ? 'Backend administrativo verificado y listo.' : (claimsReady ? clean(result.message, 300) : 'Backend disponible; falta sincronizar los claims del Admin Maestro.')
      };
    }catch(error){ return backendFailureState(error); }
  }
  async function loadCurrentAccess(){
    const authState = g.A33FirebaseAuth && g.A33FirebaseAuth.getState ? g.A33FirebaseAuth.getState() : {};
    const user = authState.user || null;
    const ws = workspaceId();
    if (!user){ state = Object.assign(baseState(), { workspaceId:ws }); dispatch(); return getState(); }
    setState({ user, workspaceId:ws, loadingProfile:true, backendHealth:'checking', backendMessage:'Leyendo el perfil y verificando Functions…' });
    try{
      await ensureFirestore();
      let profile = null;
      try{
        const snap = await firestore.collection('workspaces').doc(ws).collection('members').doc(user.uid).get();
        if (snap.exists) profile = normalizeProfile(snap.data(), user.uid);
      }catch(_){ profile = null; }
      const role = profile ? profile.role : '';
      const active = !!(profile && profile.status === 'active');
      const permissions = active ? profile.permissions.slice() : [];
      const isAdmin = active && role === 'admin';
      const backend = await verifyBackend({ workspaceId:ws, isAdmin, active });
      return setState(Object.assign({ user, profile, workspaceId:ws, role, roleLabel:roleMeta(role) ? roleMeta(role).label : 'Sin rol', statusLabel:profile ? (active ? 'Activo' : 'Inactivo') : 'Sin estado', permissions, backendMode:BACKEND_MODE, loadingProfile:false, profileMissing:!profile, isAdmin }, backend));
    }catch(error){
      return setState({ user, workspaceId:ws, loadingProfile:false, backendMode:BACKEND_MODE, backendHealth:'error', backendMessage:clean(error && error.message, 300) || 'No se pudo leer el perfil de Firestore.', managementReady:false, canBootstrap:false, profileMissing:true, isAdmin:false });
    }
  }
  async function init(){
    if (initPromise) return initPromise;
    initPromise = loadCurrentAccess().finally(function(){ initPromise=null; });
    return initPromise;
  }
  async function listUsers(){
    if (!state.user) return [];
    if (!state.isAdmin) return state.profile ? [Object.assign({}, state.profile)] : [];
    await ensureFirestore();
    const snap = await firestore.collection('workspaces').doc(state.workspaceId).collection('members').get();
    return snap.docs.map(function(doc){ return normalizeProfile(doc.data(), doc.id); });
  }
  async function saveUser(input){
    if (!state.managementReady) throw new Error('Tu sesión no tiene administración de usuarios activa.');
    return call('a33AdminUpsertUser', Object.assign({}, input || {}, { workspaceId:state.workspaceId }));
  }
  async function deleteUser(uid){
    if (!state.managementReady) throw new Error('Tu sesión no tiene administración de usuarios activa.');
    return call('a33AdminDeleteUser', { workspaceId:state.workspaceId, uid:clean(uid, 160) });
  }
  async function bootstrapAdmin(){
    if (!state.user || !state.canBootstrap) throw new Error('El admin inicial no está disponible para esta sesión.');
    const result = await call('a33BootstrapWorkspaceAdmin', { workspaceId:state.workspaceId });
    if (g.A33FirebaseAuth && g.A33FirebaseAuth.refreshToken) await g.A33FirebaseAuth.refreshToken();
    await loadCurrentAccess();
    return result;
  }
  function hasPermission(permission){ return state.permissions.includes(clean(permission, 80)); }
  function moduleMeta(moduleId){ return moduleOptions.find(function(item){ return item.key === clean(moduleId, 80).toLowerCase(); }) || null; }
  function evaluateModuleAccess(moduleId, accessOverride, options){
    const current = accessOverride && typeof accessOverride === 'object' ? accessOverride : state;
    const meta = moduleMeta(moduleId);
    const enforcementEnabled = !!(options && options.enforcementEnabled);
    if (!enforcementEnabled) return { allowed:true, reason:'enforcement-disabled', permission:meta ? meta.permission : '' };
    if (!meta) return { allowed:false, reason:'module-unknown', permission:'' };
    const profile = current.profile && typeof current.profile === 'object' ? current.profile : null;
    const active = !!(profile && profile.status === 'active');
    const role = clean(current.role || (profile && profile.role), 40);
    if (active && role === 'admin') return { allowed:true, reason:'admin-recovery', permission:meta.permission };
    if (!current.user || !active) return { allowed:false, reason:'profile-unavailable', permission:meta.permission };
    const permissions = Array.isArray(current.permissions) ? current.permissions : [];
    return { allowed:permissions.includes(meta.permission), reason:permissions.includes(meta.permission) ? 'permission-granted' : 'permission-missing', permission:meta.permission };
  }

  g.A33Access = Object.assign({}, g.A33Access || {}, { init, refresh:loadCurrentAccess, getState, getRoleOptions:function(){ return roleOptions.map(function(item){ return Object.assign({}, item, { permissions:item.permissions.slice() }); }); }, getModuleOptions:function(){ return moduleOptions.map(function(item){ return Object.assign({}, item); }); }, evaluateModuleAccess, hasPermission, listUsers, saveUser, deleteUser, bootstrapAdmin });
  if (g.addEventListener) g.addEventListener('a33:auth-state', function(){ loadCurrentAccess().catch(function(){}); });
  try{ init(); }catch(_){ }
})(typeof globalThis !== 'undefined' ? globalThis : window);
