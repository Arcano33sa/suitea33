/* Suite A33 — perfiles, roles y administración segura de Firebase (E3). */
(function(g){
  'use strict';

  const SDK_VERSION = '10.12.5';
  const REGION = 'us-central1';
  const BACKEND_MODE = 'spark-manual';
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
  let firestore = null;
  let functions = null;
  let initPromise = null;
  let state = baseState();

  function baseState(){ return { user:null, profile:null, workspaceId:'arcano33', role:'', roleLabel:'Sin rol', statusLabel:'Sin estado', permissions:[], backendMode:BACKEND_MODE, backendHealth:BACKEND_MODE, backendMessage:'Plan Spark: perfiles y roles se administran manualmente desde Firebase.', managementReady:false, canBootstrap:false, loadingProfile:false, profileMissing:false, isAdmin:false }; }
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
  async function loadCurrentAccess(){
    const authState = g.A33FirebaseAuth && g.A33FirebaseAuth.getState ? g.A33FirebaseAuth.getState() : {};
    const user = authState.user || null;
    const ws = workspaceId();
    if (!user){ state = Object.assign(baseState(), { workspaceId:ws }); dispatch(); return getState(); }
    setState({ user, workspaceId:ws, loadingProfile:true, backendHealth:BACKEND_MODE, backendMessage:'Leyendo el perfil del usuario en Firestore…' });
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
      return setState({ user, profile, workspaceId:ws, role, roleLabel:roleMeta(role) ? roleMeta(role).label : 'Sin rol', statusLabel:profile ? (active ? 'Activo' : 'Inactivo') : 'Sin estado', permissions, backendMode:BACKEND_MODE, backendHealth:BACKEND_MODE, backendMessage:'Plan Spark activo. Los perfiles se consultan en Firestore y los usuarios se administran manualmente en Firebase.', managementReady:false, canBootstrap:false, loadingProfile:false, profileMissing:!profile, isAdmin });
    }catch(error){
      return setState({ user, workspaceId:ws, loadingProfile:false, backendMode:BACKEND_MODE, backendHealth:BACKEND_MODE, backendMessage:clean(error && error.message, 300) || 'No se pudo leer el perfil de Firestore.', managementReady:false, canBootstrap:false, profileMissing:true, isAdmin:false });
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

  g.A33Access = Object.assign({}, g.A33Access || {}, { init, refresh:loadCurrentAccess, getState, getRoleOptions:function(){ return roleOptions.map(function(item){ return Object.assign({}, item, { permissions:item.permissions.slice() }); }); }, hasPermission, listUsers, saveUser, deleteUser, bootstrapAdmin });
  if (g.addEventListener) g.addEventListener('a33:auth-state', function(){ loadCurrentAccess().catch(function(){}); });
  try{ init(); }catch(_){ }
})(typeof globalThis !== 'undefined' ? globalThis : window);
