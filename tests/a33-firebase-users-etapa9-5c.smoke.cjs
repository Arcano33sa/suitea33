const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const accessSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-access.js'), 'utf8');
const guardSource = fs.readFileSync(path.join(root, 'assets/js/a33-module-guard.js'), 'utf8');
const navSource = fs.readFileSync(path.join(root, 'assets/js/a33-module-nav.js'), 'utf8');
const authSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-auth.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const posSource = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');

const guardedPages = new Map([
  ['produccion', 'calculadora/index.html'],
  ['lotes', 'lotes/index.html'],
  ['inventario', 'inventario/index.html'],
  ['pos', 'pos/index.html'],
  ['analitica', 'analitica/index.html'],
  ['pedidos', 'pedidos/index.html'],
  ['finanzas', 'finanzas/index.html'],
  ['catalogos', 'catalogos/index.html'],
  ['agenda', 'agenda/index.html'],
  ['centro-mando', 'centro-mando/index.html'],
  ['configuracion', 'configuracion/index.html'],
  ['temporal', 'calculadora_temporal/index.html']
]);

const sandbox = { console, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(accessSource, sandbox, { filename: 'a33-firebase-access.js' });
const access = sandbox.A33Access;
assert(access, 'La política de acceso no quedó disponible.');

const roles = access.getRoleOptions();
assert.deepEqual(Array.from(roles, (role) => role.key), ['admin', 'usuario']);
const modules = access.getModuleOptions();
assert.equal(modules.length, 12, 'La política debe cubrir exactamente los 12 módulos canónicos.');
assert.deepEqual(new Set(Array.from(modules, (module) => module.key)), new Set(guardedPages.keys()));

function state(role) {
  const definition = roles.find((item) => item.key === role);
  return {
    user: { uid: `${role}-uid` },
    profile: { role, status: 'active' },
    role,
    permissions: Array.from(definition.permissions)
  };
}

const admin = state('admin');
const usuario = state('usuario');
for (const module of modules) {
  assert.equal(access.evaluateModuleAccess(module.key, admin, { enforcementEnabled: true }).allowed, true, `Admin debe abrir ${module.key}.`);
  assert.equal(
    access.evaluateModuleAccess(module.key, usuario, { enforcementEnabled: true }).allowed,
    module.key !== 'configuracion',
    `Usuario tiene una decisión incorrecta para ${module.key}.`
  );
}
assert.equal(access.evaluateModuleAccess('ruta-inexistente', admin, { enforcementEnabled: true }).allowed, false);
assert.equal(access.evaluateModuleAccess('pos', { user:null, profile:null, permissions:[] }, { enforcementEnabled: true }).allowed, false);

for (const [moduleId, relativeFile] of guardedPages) {
  const html = fs.readFileSync(path.join(root, relativeFile), 'utf8');
  assert(html.includes(`data-a33-module="${moduleId}"`), `${relativeFile} no declara el módulo ${moduleId}.`);
  assert(/a33-module-guard\.js\?v=4\.20\.98(?:&|&amp;)r=6/.test(html), `${relativeFile} no carga la guarda activa r6.`);
  assert(/a33-module-nav\.js\?v=4\.20\.98(?:&|&amp;)r=4/.test(html), `${relativeFile} no carga la navegación r4.`);
  assert(/a33-module-nav\.css\?v=4\.20\.98(?:&|&amp;)r=4/.test(html), `${relativeFile} no carga los estilos de navegación r4.`);
}

assert(guardSource.includes('const ENFORCEMENT_ENABLED = true;'));
assert(guardSource.includes("moduleId() === 'configuracion' ? 'Acceder como Maestro' : 'Iniciar sesión'"));
assert(authSource.includes('async function signOut()'));
assert(authSource.includes('if (auth) await auth.signOut();'));
assert(navSource.includes("signOut.textContent = 'Cerrar sesión'"));
assert(navSource.includes('await g.A33FirebaseAuth.signOut();'));
assert(navSource.includes("g.location.assign('/index.html');"));
assert(configSource.includes('id="cfg-auth-signout"'));

for (const relativeFile of [
  'agenda/sw.js', 'inventario/sw.js', 'pos/sw.js', 'lotes/sw.js', 'centro-mando/sw.js',
  'calculadora/sw.js', 'pedidos/sw.js', 'catalogos/sw.js', 'calculadora_temporal/sw.js'
]) {
  const sw = fs.readFileSync(path.join(root, relativeFile), 'utf8');
  assert(sw.includes('/assets/js/a33-module-nav.js?v=4.20.98&r=4'), `${relativeFile} no precarga la navegación r4.`);
  assert(sw.includes('/assets/css/a33-module-nav.css?v=4.20.98&r=4'), `${relativeFile} no precarga los estilos r4.`);
}

assert(posSource.includes("profile.status === 'active' && role === 'admin'"));
assert(posSource.includes("requireProtectedClosurePOS('cerrar eventos')"));
assert.equal((posSource.match(/requireProtectedClosurePOS\('cerrar períodos'\)/g) || []).length, 2);

console.log('OK — E9.5C valida Admin 12/12, Usuario 11/12, cierres protegidos y salida de sesión.');
