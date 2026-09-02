'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const authSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-auth.js'), 'utf8');
const firebaseConfigSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-config.js'), 'utf8');
const accessSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-access.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(root, 'assets/js/a33-module-access.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'configuracion/style.css'), 'utf8');
const functionsSource = fs.readFileSync(path.join(root, 'functions/src/index.js'), 'utf8');

const events = [];
const listeners = {};
function CustomEvent(type, options){ this.type=type; this.detail=options && options.detail; }
const sandbox = {
  console, Promise, Object, Array, String, JSON, Date, RegExp, URL, CustomEvent,
  localStorage:{ getItem(){ return null; }, setItem(){} },
  A33FirebaseSettings:{ read(){ return { enabled:false, configured:false, workspaceId:'arcano33', credentials:{} }; } },
  A33Firebase:{ isFirebaseConfigured(){ return false; } },
  dispatchEvent(event){ events.push(event); (listeners[event.type] || []).forEach((handler) => handler(event)); },
  addEventListener(type, handler){ (listeners[type] || (listeners[type]=[])).push(handler); }
};
sandbox.window=sandbox;
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(firebaseConfigSource, sandbox, { filename:'a33-firebase-config.js' });
const webConfig = {
  workspaceId:'arcano33',
  credentials:{ apiKey:'public-key', authDomain:'suite.firebaseapp.com', projectId:'suite-a33', appId:'1:123:web:abc', databaseURL:'' }
};
assert.strictEqual(sandbox.A33FirebaseSettings.hasMinimumConfig(webConfig), true, 'Auth/Firestore no deben exigir Realtime Database');
assert.strictEqual(sandbox.A33FirebaseSettings.hasRealtimeConfig(webConfig), false, 'La prueba Realtime debe seguir exigiendo databaseURL');
vm.runInContext(authSource, sandbox, { filename:'a33-firebase-auth.js' });
vm.runInContext(accessSource, sandbox, { filename:'a33-firebase-access.js' });
vm.runInContext(moduleSource, sandbox, { filename:'a33-module-access.js' });

assert(sandbox.A33FirebaseAuth, 'No se publicó A33FirebaseAuth');
assert.strictEqual(sandbox.A33FirebaseAuth.getState().status, 'disabled', 'Auth debe iniciar bloqueado si Firebase está apagado');
assert.strictEqual(sandbox.A33FirebaseAuth.getState().authenticated, false, 'Auth desactivado no debe declararse autenticado');
assert.strictEqual(sandbox.A33FirebaseAuth.getCurrentUser(), null, 'No debe inventarse una sesión local');
assert(sandbox.A33Access, 'No se publicó A33Access');
assert.strictEqual(sandbox.A33Access.getState().workspaceId, 'arcano33', 'Workspace de seguridad inesperado');
const roles = sandbox.A33Access.getRoleOptions();
assert.deepStrictEqual(Array.from(roles, (role) => role.key), ['admin','ventas','finanzas','consulta']);
assert(roles.find((role) => role.key === 'admin').permissions.includes('users.manage'), 'Admin no incluye gestión de usuarios');
assert(roles.find((role) => role.key === 'finanzas').permissions.includes('finance.use'), 'Finanzas no incluye permiso financiero');
const modules = sandbox.A33Access.getModuleOptions();
assert.strictEqual(modules.length, 12, 'La política central no cubre todo el menú global');
assert.strictEqual(modules.find((module) => module.key === 'produccion').permission, 'production.use');
assert.strictEqual(modules.find((module) => module.key === 'temporal').permission, 'sandbox.use');
assert.strictEqual(sandbox.A33ModuleAccess.isEnabled(), false, 'E3 no debe activar el bloqueo de módulos');
assert.strictEqual(sandbox.A33ModuleAccess.canOpen('finanzas'), true, 'E3 debe conservar acceso local a Finanzas');
assert.strictEqual(sandbox.A33ModuleAccess.requiredPermission('finanzas'), 'finance.use');
assert.strictEqual(sandbox.A33ModuleAccess.requiredPermission('produccion'), 'production.use');
assert.strictEqual(sandbox.A33Access.evaluateModuleAccess('pos', { user:{uid:'master'}, profile:{role:'admin',status:'active'}, role:'admin', permissions:[] }, { enforcementEnabled:true }).reason, 'admin-recovery');

assert(html.includes('id="cfg-auth-form"'), 'Falta formulario de acceso maestro');
assert(html.includes('id="cfg-auth-password"'), 'Falta campo de contraseña');
assert(html.includes('no se guarda en localStorage'), 'Falta aviso de privacidad de contraseña');
assert(html.includes('a33-firebase-auth.js?v=4.20.98&amp;r=17'), 'No se actualizó la revisión de Auth');
assert(html.includes('a33-firebase-access.js?v=4.20.98&amp;r=17'), 'No se actualizó la revisión de Acceso');
assert(html.includes('script.js?v=4.20.98&amp;r=55'), 'No se actualizó la revisión de Configuración');
assert(configSource.includes('function initAuthSection()'), 'Falta inicialización del acceso maestro');
assert(configSource.includes("A33Toast?.process('Verificando acceso seguro…'"), 'Falta Toast azul durante el acceso');
assert(configSource.includes("'Sesión iniciada correctamente.', 'success'"), 'Falta confirmación verde de acceso');
assert(configSource.includes("'No se pudo iniciar sesión.'), 'error'"), 'Falta Toast rojo de error');
assert(css.includes('.cfg-auth-card'), 'Falta estilo del acceso maestro');
assert(css.includes('.cfg-auth-form'), 'Falta diseño responsivo del formulario');

for (const callable of ['a33AdminHealthcheck','a33BootstrapWorkspaceAdmin','a33AdminUpsertUser','a33AdminDeleteUser']) {
  assert(functionsSource.includes(`exports.${callable} = onCall`), `Falta Function ${callable}`);
}
for (const callable of ['a33BootstrapWorkspaceAdmin','a33AdminUpsertUser','a33AdminDeleteUser']) {
  assert(accessSource.includes(`'${callable}'`), `El cliente no conserva el contrato futuro ${callable}`);
}
assert(!accessSource.includes("call('a33AdminHealthcheck'"), 'Spark no debe verificar Functions automáticamente');
assert(!authSource.includes('localStorage.setItem'), 'Auth no debe persistir contraseñas ni sesiones manualmente');
assert(authSource.includes("authenticated:state.status === 'authenticated' && !!state.user"), 'Auth no publica el indicador compatible que requieren E4-E6');
assert(authSource.includes('signInWithEmailAndPassword'), 'Auth no usa Email/Password de Firebase');
assert(accessSource.includes("collection('members')"), 'Seguridad no lee perfiles de Firestore');
assert(accessSource.includes("const BACKEND_MODE = 'spark-manual'"), 'Seguridad no declara el modo Spark manual');
assert(accessSource.includes('async function ensureFirestore()'), 'Spark no separa Firestore de Functions');
assert(configSource.includes("backendHealth === 'spark-manual'"), 'Configuración no presenta el estado Spark');

const rulesSource = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
assert(rulesSource.includes(": 'arcano33';"), 'Las reglas no usan arcano33 como workspace inicial');

console.log('SMOKE OK');
console.log('- Auth Email/Password bloqueado hasta configurar Firebase');
console.log('- Roles, perfiles, modo Spark y workspace arcano33 conectados');
console.log('- Acceso maestro y Toasts de proceso/éxito/error verificados');
console.log('- Bloqueo de módulos permanece apagado en E3');
