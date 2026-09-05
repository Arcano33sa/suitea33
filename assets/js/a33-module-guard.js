/* Suite A33 — guarda común de módulos (E8.4A preparada, compuerta apagada). */
(function(g){
  'use strict';

  const ENFORCEMENT_ENABLED = false;
  const dependencies = [
    ['a33-firebase-config', '/assets/js/a33-firebase-config.js?v=4.20.98&r=19'],
    ['a33-firebase-core', '/assets/js/a33-firebase-core.js?v=4.20.98&r=19'],
    ['a33-firebase-auth', '/assets/js/a33-firebase-auth.js?v=4.20.98&r=17'],
    ['a33-firebase-access', '/assets/js/a33-firebase-access.js?v=4.20.98&r=17'],
    ['a33-module-access', '/assets/js/a33-module-access.js?v=4.20.98&r=16']
  ];
  let accessPromise = null;

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
    if (g.A33ModuleAccess && g.A33Access) return g.A33ModuleAccess;
    if (!accessPromise){
      accessPromise = dependencies.reduce(function(chain, dependency){
        return chain.then(function(){ return loadScript(dependency[0], dependency[1]); });
      }, Promise.resolve()).then(function(){
        if (!g.A33ModuleAccess || !g.A33Access) throw new Error('La política de acceso no quedó disponible.');
        return g.A33ModuleAccess;
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
    const api = await ensureAccess();
    return { allowed:api.canOpen(target), reason:api.canOpen(target) ? 'access-granted' : 'access-denied', moduleId:String(target || '') };
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
  function init(){
    const node = header();
    if (!node || node.dataset.a33GuardReady === '1') return getState();
    node.dataset.a33GuardReady = '1';
    node.dataset.a33GuardMode = ENFORCEMENT_ENABLED ? 'enforced' : 'prepared-disabled';
    document.addEventListener('click', handleNavigation, true);
    return getState();
  }

  g.A33ModuleGuard = Object.assign({}, g.A33ModuleGuard || {}, { init:init, getState:getState, evaluate:evaluate, simulate:simulate, isEnabled:function(){ return ENFORCEMENT_ENABLED; } });
  if (typeof document !== 'undefined'){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
    else init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
