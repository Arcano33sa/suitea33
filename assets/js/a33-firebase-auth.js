/* Suite A33 — Firebase Auth (E3). Acceso por correo, bloqueado mientras Firebase no esté configurado. */
(function(g){
  'use strict';

  const SDK_VERSION = '10.12.5';
  const SCRIPT_ID = 'a33-firebase-sdk-auth-compat';
  const SCRIPT_URL = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-auth-compat.js';
  let auth = null;
  let unsubscribe = null;
  let initPromise = null;
  let state = { ready:false, status:'disabled', message:'Firebase está desactivado. La Suite continúa en modo local.', user:null, mode:'local-first', lastError:'' };

  function clean(value, maxLen){ return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 320); }
  function settings(){ try{ return g.A33FirebaseSettings && g.A33FirebaseSettings.read ? g.A33FirebaseSettings.read() : null; }catch(_){ return null; } }
  function isConfigured(data){ try{ return !!(g.A33Firebase && g.A33Firebase.isFirebaseConfigured && g.A33Firebase.isFirebaseConfigured(data)); }catch(_){ return false; } }
  function publicUser(user){
    if (!user) return null;
    return { uid:clean(user.uid, 160), email:clean(user.email, 180).toLowerCase(), displayName:clean(user.displayName, 160), emailVerified:!!user.emailVerified };
  }
  function getState(){ return Object.assign({}, state, { user:state.user ? Object.assign({}, state.user) : null }); }
  function dispatch(){ try{ if (typeof g.CustomEvent === 'function' && g.dispatchEvent) g.dispatchEvent(new CustomEvent('a33:auth-state', { detail:getState() })); }catch(_){ } }
  function setState(patch){ state = Object.assign({}, state, patch || {}); dispatch(); return getState(); }

  function loadScript(){
    return new Promise(function(resolve, reject){
      if (g.firebase && typeof g.firebase.auth === 'function') return resolve();
      if (typeof document === 'undefined') return reject(new Error('Firebase Auth requiere un navegador.'));
      const current = document.getElementById(SCRIPT_ID);
      if (current){
        current.addEventListener('load', resolve, { once:true });
        current.addEventListener('error', function(){ reject(new Error('No se pudo cargar Firebase Auth.')); }, { once:true });
        return;
      }
      const script = document.createElement('script');
      script.id=SCRIPT_ID; script.src=SCRIPT_URL; script.async=true; script.crossOrigin='anonymous'; script.onload=resolve;
      script.onerror=function(){ reject(new Error('No se pudo cargar Firebase Auth.')); };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function friendlyError(error){
    const code = clean(error && error.code, 120).toLowerCase();
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Correo o contraseña incorrectos.';
    if (code.includes('invalid-email')) return 'El correo no tiene un formato válido.';
    if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
    if (code.includes('network-request-failed')) return 'No hay conexión con Firebase en este momento.';
    if (code.includes('user-disabled')) return 'Este usuario está desactivado.';
    return clean(error && error.message, 280) || 'No se pudo iniciar sesión.';
  }

  async function init(){
    const data = settings();
    if (!data || !data.enabled) return setState({ ready:false, status:'disabled', mode:'local-first', user:null, message:'Firebase está desactivado. La Suite continúa en modo local.', lastError:'' });
    if (!isConfigured(data)) return setState({ ready:false, status:'not-configured', mode:'local-first', user:null, message:'Faltan las credenciales web de Firebase.', lastError:'' });
    if (initPromise) return initPromise;
    initPromise = (async function(){
      try{
        setState({ status:'loading', message:'Preparando acceso seguro…', lastError:'' });
        if (!g.A33Firebase || typeof g.A33Firebase.initFirebaseApp !== 'function') throw new Error('Firebase Core no está disponible.');
        const app = await g.A33Firebase.initFirebaseApp(data);
        await loadScript();
        auth = g.firebase.auth(app);
        if (unsubscribe) unsubscribe();
        unsubscribe = auth.onAuthStateChanged(function(user){
          setState({ ready:true, status:user ? 'authenticated' : 'ready', mode:'firebase-auth', user:publicUser(user), message:user ? 'Sesión segura activa.' : 'Firebase Auth listo para iniciar sesión.', lastError:'' });
        }, function(error){
          const message = friendlyError(error);
          setState({ ready:false, status:'error', user:null, message, lastError:message });
        });
        setState({ ready:true, status:auth.currentUser ? 'authenticated' : 'ready', mode:'firebase-auth', user:publicUser(auth.currentUser), message:auth.currentUser ? 'Sesión segura activa.' : 'Firebase Auth listo para iniciar sesión.', lastError:'' });
        return getState();
      }catch(error){
        initPromise = null;
        const message = friendlyError(error);
        return setState({ ready:false, status:'error', mode:'local-first', user:null, message, lastError:message });
      }
    })();
    return initPromise;
  }

  async function signIn(email, password){
    const normalizedEmail = clean(email, 180).toLowerCase();
    if (!normalizedEmail || !String(password || '')) throw new Error('Escribe el correo y la contraseña.');
    const current = await init();
    if (!current.ready || !auth) throw new Error(current.message || 'Firebase Auth todavía no está listo.');
    setState({ status:'signing-in', message:'Verificando credenciales…', lastError:'' });
    try{
      const credential = await auth.signInWithEmailAndPassword(normalizedEmail, String(password));
      return { ok:true, user:publicUser(credential && credential.user) };
    }catch(error){
      const message = friendlyError(error);
      setState({ status:'error', message, lastError:message, user:null });
      throw new Error(message);
    }
  }
  async function signOut(){
    if (auth) await auth.signOut();
    setState({ status:state.ready ? 'ready' : state.status, user:null, message:state.ready ? 'Sesión cerrada.' : state.message, lastError:'' });
    return { ok:true };
  }
  async function refreshToken(){
    const user = auth && auth.currentUser;
    if (!user) throw new Error('No hay una sesión activa.');
    await user.getIdToken(true);
    return publicUser(user);
  }

  g.A33FirebaseAuth = Object.assign({}, g.A33FirebaseAuth || {}, { init, refresh:init, getState, getCurrentUser:function(){ return state.user ? Object.assign({}, state.user) : null; }, getNativeUser:function(){ return auth && auth.currentUser ? auth.currentUser : null; }, signIn, signOut, refreshToken });
  try{ init(); }catch(_){ }
})(typeof globalThis !== 'undefined' ? globalThis : window);
