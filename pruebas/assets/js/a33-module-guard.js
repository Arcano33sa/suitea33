/* Suite A33 — guarda común de módulos (E8.4C activa con recuperación segura). */
(function(g){
  'use strict';

  const ENFORCEMENT_ENABLED = true;
  const dependencies = [
    ['a33-firebase-config', '/assets/js/a33-firebase-config.js?v=4.20.98&r=19'],
    ['a33-firebase-core', '/assets/js/a33-firebase-core.js?v=4.20.98&r=19'],
    ['a33-firebase-auth', '/assets/js/a33-firebase-auth.js?v=4.20.98&r=18'],
    ['a33-firebase-access', '/assets/js/a33-firebase-access.js?v=4.20.98&r=18'],
    ['a33-module-access', '/assets/js/a33-module-access.js?v=4.20.98&r=16']
  ];
  let accessPromise = null;
  let accessReady = false;
  let verificationPromise = null;
  let authenticationInProgress = false;

  function header(){ return typeof document === 'undefined' ? null : document.querySelector('.a33-header[data-a33-module]'); }
  function moduleId(){ const node = header(); return node ? String(node.dataset.a33Module || '').trim() : ''; }
  function loadScript(id, src){
    return new Promise(function(resolve, reject){
      if (document.getElementById(id)) return resolve();
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = function(){ reject(new Error('No se pudo cargar la política de acceso.')); };
      (document.head || document.documentElement).appendChild(script);
    });
  }
  async function ensureAccess(){
    if (g.A33ModuleAccess && g.A33Access && accessReady) return g.A33ModuleAccess;
    if (!accessPromise){
      const dependenciesReady = g.A33ModuleAccess && g.A33Access
        ? Promise.resolve()
        : dependencies.reduce(function(chain, dependency){
          return chain.then(function(){ return loadScript(dependency[0], dependency[1]); });
        }, Promise.resolve());
      accessPromise = dependenciesReady.then(function(){
        if (!g.A33ModuleAccess || !g.A33Access) throw new Error('La política de acceso no quedó disponible.');
        return Promise.resolve(g.A33FirebaseAuth && g.A33FirebaseAuth.init ? g.A33FirebaseAuth.init() : null)
          .then(function(){ return g.A33Access && g.A33Access.refresh ? g.A33Access.refresh() : null; })
          .then(function(){ accessReady = true; return g.A33ModuleAccess; });
      }).finally(function(){ accessPromise = null; });
    }
    return accessPromise;
  }
  function targetModule(link){ return String(link && link.dataset ? link.dataset.a33ModuleTarget || '' : '').trim(); }
  function getState(){
    return { stage:'E8.4A', installed:!!header(), moduleId:moduleId(), enforcementEnabled:ENFORCEMENT_ENABLED, mode:ENFORCEMENT_ENABLED ? 'enforced' : 'prepared-disabled' };
  }
  async function evaluate(target){
    if (!ENFORCEMENT_ENABLED) return { allowed:true, reason:'guard-disabled', moduleId:String(target || '') };
    await ensureAccess();
    const result = simulate(target, g.A33Access.getState());
    return Object.assign({ moduleId:String(target || '') }, result);
  }
  function simulate(target, accessOverride){
    const accessApi = g.A33Access;
    if (!accessApi || typeof accessApi.evaluateModuleAccess !== 'function') throw new Error('La política de acceso no está disponible para la prueba controlada.');
    return accessApi.evaluateModuleAccess(target, accessOverride, { enforcementEnabled:true });
  }
  async function handleNavigation(event){
    if (!ENFORCEMENT_ENABLED) return;
    const link = event.target && event.target.closest ? event.target.closest('a[data-a33-module-target]') : null;
    if (!link) return;
    event.preventDefault();
    try{
      const result = await evaluate(targetModule(link));
      if (result.allowed) g.location.assign(link.href);
      else if (g.A33Toast) g.A33Toast.warning('Tu perfil no tiene acceso a este módulo.');
    }catch(_){
      if (g.A33Toast) g.A33Toast.error('No se pudo verificar el acceso al módulo.');
    }
  }
  function overlay(){ return typeof document === 'undefined' ? null : document.getElementById('a33-module-guard-overlay'); }
  function addOverlayStyles(){
    if (document.getElementById('a33-module-guard-styles')) return;
    const style = document.createElement('style');
    style.id = 'a33-module-guard-styles';
    style.textContent = '.a33-module-guard-overlay{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#070707;color:#f8f3e7;font-family:Arial,sans-serif}.a33-module-guard-card{width:min(520px,100%);padding:30px;border:1px solid #9b782b;border-radius:24px;background:#15110f;box-shadow:0 24px 80px #000}.a33-module-guard-card h1{margin:0 0 12px;color:#e4c25b;font:700 26px Georgia,serif}.a33-module-guard-card p{line-height:1.55;color:#d8d1c6}.a33-module-guard-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}.a33-module-guard-button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border:1px solid #c49b36;border-radius:999px;background:#7f1115;color:#fff;font-weight:700;text-decoration:none;cursor:pointer}.a33-module-guard-field{display:grid;gap:6px;margin-top:14px}.a33-module-guard-field input{min-height:44px;padding:0 13px;border:1px solid #67532a;border-radius:10px;background:#080808;color:#fff}.a33-module-guard-error{min-height:22px;color:#ffaaa8}';
    (document.head || document.documentElement).appendChild(style);
  }
  function showGate(options){
    const data = options || {};
    addOverlayStyles();
    let node = overlay();
    if (!node){
      node = document.createElement('section');
      node.id = 'a33-module-guard-overlay';
      node.className = 'a33-module-guard-overlay';
      node.setAttribute('role', 'dialog');
      node.setAttribute('aria-modal', 'true');
      document.body.appendChild(node);
    }
    Array.from(document.body.children).forEach(function(child){ if (child !== node) child.inert = true; });
    node.innerHTML = '<div class="a33-module-guard-card"><h1></h1><p class="a33-module-guard-copy"></p><div class="a33-module-guard-recovery"></div><p class="a33-module-guard-error" aria-live="polite"></p><div class="a33-module-guard-actions"></div></div>';
    node.querySelector('h1').textContent = data.title || 'Verificando acceso…';
    node.querySelector('.a33-module-guard-copy').textContent = data.copy || 'Suite A33 está comprobando tu perfil y permisos.';
    const actions = node.querySelector('.a33-module-guard-actions');
    if (data.blocked){
      const home = document.createElement('a');
      home.className = 'a33-module-guard-button';
      home.href = '/index.html';
      home.textContent = 'Volver al inicio';
      actions.appendChild(home);
      renderRecoveryForm(node);
    }
    return node;
  }
  function renderRecoveryForm(node){
    const host = node.querySelector('.a33-module-guard-recovery');
    host.innerHTML = '<label class="a33-module-guard-field"><span>Correo</span><input type="email" autocomplete="username"></label><label class="a33-module-guard-field"><span>Contraseña</span><input type="password" autocomplete="current-password"></label>';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'a33-module-guard-button';
    button.textContent = moduleId() === 'configuracion' ? 'Acceder como Maestro' : 'Iniciar sesión';
    node.querySelector('.a33-module-guard-actions').prepend(button);
    button.addEventListener('click', async function(){
      const inputs = host.querySelectorAll('input');
      const error = node.querySelector('.a33-module-guard-error');
      button.disabled = true;
      error.textContent = '';
      authenticationInProgress = true;
      try{
        await g.A33FirebaseAuth.signIn(inputs[0].value, inputs[1].value);
        inputs[1].value = '';
        await g.A33Access.refresh();
        authenticationInProgress = false;
        await verifyCurrentModule();
      }catch(failure){
        authenticationInProgress = false;
        inputs[1].value = '';
        error.textContent = String(failure && failure.message || 'No se pudo iniciar sesión.');
      }finally{ authenticationInProgress = false; button.disabled = false; }
    });
  }
  function unlock(){
    const node = overlay();
    Array.from(document.body.children).forEach(function(child){ if (child !== node) child.inert = false; });
    if (node) node.remove();
  }
  async function verifyCurrentModule(){
    if (!ENFORCEMENT_ENABLED || verificationPromise) return verificationPromise || { allowed:true, reason:'guard-disabled' };
    verificationPromise = (async function(){
      showGate();
      try{
        await ensureAccess();
        const result = simulate(moduleId(), g.A33Access.getState());
        if (result.allowed) unlock();
        else showGate({ blocked:true, title:'Acceso restringido', copy:result.reason === 'profile-unavailable' ? 'Inicia sesión con un perfil activo que tenga acceso a este módulo.' : 'Tu perfil no tiene permiso para abrir este módulo.' });
        return result;
      }catch(error){
        showGate({ blocked:true, title:'No se pudo verificar el acceso', copy:String(error && error.message || 'Revisa la configuración de Firebase e inténtalo nuevamente.') });
        return { allowed:false, reason:'verification-error' };
      }finally{ verificationPromise = null; }
    })();
    return verificationPromise;
  }
  function init(){
    const node = header();
    if (!node || node.dataset.a33GuardReady === '1') return getState();
    node.dataset.a33GuardReady = '1';
    node.dataset.a33GuardMode = ENFORCEMENT_ENABLED ? 'enforced' : 'prepared-disabled';
    document.addEventListener('click', handleNavigation, true);
    if (g.addEventListener) g.addEventListener('a33:access-state', function(){
      if (!authenticationInProgress) verifyCurrentModule();
    });
    verifyCurrentModule();
    return getState();
  }

  g.A33ModuleGuard = Object.assign({}, g.A33ModuleGuard || {}, { init:init, getState:getState, evaluate:evaluate, simulate:simulate, verifyCurrentModule:verifyCurrentModule, isEnabled:function(){ return ENFORCEMENT_ENABLED; } });
  if (typeof document !== 'undefined'){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
    else init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
