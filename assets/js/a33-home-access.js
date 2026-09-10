/* Suite A33 — control visible de módulos en Inicio por perfil real (E10.2). */
(function(g){
  'use strict';

  const dependencies = [
    ['a33-firebase-config', '/assets/js/a33-firebase-config.js?v=4.20.98&r=19'],
    ['a33-firebase-core', '/assets/js/a33-firebase-core.js?v=4.20.98&r=19'],
    ['a33-firebase-auth', '/assets/js/a33-firebase-auth.js?v=4.20.98&r=18'],
    ['a33-firebase-access', '/assets/js/a33-firebase-access.js?v=4.20.98&r=18']
  ];
  let authenticationInProgress = false;
  let refreshPromise = null;

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

  function cards(){ return Array.from(document.querySelectorAll('.card[data-a33-module-target]')); }
  function panel(){ return document.getElementById('a33-home-access'); }
  function setText(selector, value){ const node = panel() && panel().querySelector(selector); if (node) node.textContent = value; }
  function setSectionsVisibility(){
    document.querySelectorAll('#home-view > .menu-section').forEach(function(section){
      section.dataset.a33AccessEmpty = String(!section.querySelector('.card[data-a33-module-target]:not([hidden])'));
    });
  }
  function hideAllCards(){ cards().forEach(function(card){ card.hidden = true; }); setSectionsVisibility(); }
  function showPanel(title, message){
    const node = panel();
    if (!node) return;
    node.hidden = false;
    setText('[data-a33-home-access-title]', title);
    setText('[data-a33-home-access-message]', message);
  }
  function showForm(visible){ const form = panel() && panel().querySelector('[data-a33-home-access-form]'); if (form) form.hidden = !visible; }
  function showSignedActions(visible){ const actions = panel() && panel().querySelector('[data-a33-home-signed-actions]'); if (actions) actions.hidden = !visible; }

  function applyAccess(state){
    const current = state && typeof state === 'object' ? state : {};
    const profile = current.profile && typeof current.profile === 'object' ? current.profile : null;
    const active = !!(current.user && profile && profile.status === 'active');
    if (!active){
      const auth = g.A33FirebaseAuth && g.A33FirebaseAuth.getState ? g.A33FirebaseAuth.getState() : {};
      const canSignIn = !current.user && auth.ready === true && auth.status === 'ready';
      hideAllCards();
      showSignedActions(false);
      showForm(canSignIn);
      showPanel(current.user ? 'Acceso pendiente' : (canSignIn ? 'Inicia sesión' : 'Acceso no disponible'), current.user
        ? 'La sesión no tiene un perfil activo disponible para este espacio.'
        : (canSignIn ? 'Usa tu cuenta de Suite A33 para mostrar únicamente los módulos autorizados.' : (auth.message || 'No se pudo preparar el acceso seguro.')));
      return;
    }
    cards().forEach(function(card){
      const result = g.A33Access.evaluateModuleAccess(card.dataset.a33ModuleTarget, current, { enforcementEnabled:true });
      card.hidden = !result.allowed;
    });
    setSectionsVisibility();
    showForm(false);
    showSignedActions(true);
    showPanel('Acceso activo', `${current.user.email || 'Usuario'} · ${current.roleLabel || current.role || 'Perfil activo'}`);
  }

  async function refresh(){
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async function(){
      hideAllCards();
      showForm(false);
      showSignedActions(false);
      showPanel('Verificando acceso…', 'Estamos cargando tu sesión y permisos.');
      for (const dependency of dependencies) await loadScript(dependency[0], dependency[1]);
      if (!g.A33FirebaseAuth || !g.A33Access) throw new Error('La política de acceso no quedó disponible.');
      await g.A33FirebaseAuth.init();
      const state = await g.A33Access.refresh();
      applyAccess(state);
      return state;
    })().catch(function(error){
      hideAllCards();
      showForm(false);
      showSignedActions(false);
      showPanel('No se pudo verificar el acceso', String(error && error.message || 'Revisa la conexión e inténtalo nuevamente.'));
      return null;
    }).finally(function(){ refreshPromise = null; });
    return refreshPromise;
  }

  function bind(){
    const node = panel();
    if (!node || node.dataset.a33Ready === '1') return;
    node.dataset.a33Ready = '1';
    const form = node.querySelector('[data-a33-home-access-form]');
    const signOut = node.querySelector('[data-a33-home-signout]');
    if (form) form.addEventListener('submit', async function(event){
      event.preventDefault();
      const email = form.querySelector('[name="email"]');
      const password = form.querySelector('[name="password"]');
      const submit = form.querySelector('button[type="submit"]');
      const error = node.querySelector('[data-a33-home-access-error]');
      submit.disabled = true;
      error.textContent = '';
      authenticationInProgress = true;
      try{
        await g.A33FirebaseAuth.signIn(email.value, password.value);
        password.value = '';
        const state = await g.A33Access.refresh();
        authenticationInProgress = false;
        applyAccess(state);
      }catch(failure){
        authenticationInProgress = false;
        password.value = '';
        error.textContent = String(failure && failure.message || 'No se pudo iniciar sesión.');
      }finally{ authenticationInProgress = false; submit.disabled = false; }
    });
    if (signOut) signOut.addEventListener('click', async function(){
      signOut.disabled = true;
      try{ await g.A33FirebaseAuth.signOut(); await refresh(); }
      finally{ signOut.disabled = false; }
    });
    g.addEventListener('a33:access-state', function(event){ if (!authenticationInProgress && event.detail) applyAccess(event.detail); });
    refresh();
  }

  g.A33HomeAccess = Object.assign({}, g.A33HomeAccess || {}, { init:bind, refresh, applyAccess });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once:true });
  else bind();
})(typeof globalThis !== 'undefined' ? globalThis : window);
