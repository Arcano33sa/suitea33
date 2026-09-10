const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const homeAccess = fs.readFileSync(path.join(root, 'assets/js/a33-home-access.js'), 'utf8');
const accessSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-access.js'), 'utf8');

const cards = Array.from(html.matchAll(/<article class="card"[^>]*data-a33-module-target="([^"]+)"[^>]*>/g));
assert.equal(cards.length, 13, 'Inicio debe declarar 13 tarjetas visibles para 12 módulos.');
assert(cards.every((match) => /\shidden(?:\s|>)/.test(match[0])), 'Todas las tarjetas deben iniciar ocultas para evitar exposición durante la carga.');
const targets = cards.map((match) => match[1]);
assert.equal(targets.filter((target) => target === 'finanzas').length, 2, 'Finanzas debe conservar sus dos accesos directos.');
assert.equal(new Set(targets).size, 12, 'Las tarjetas deben representar los 12 módulos canónicos.');

assert(html.includes('id="a33-home-access"'));
assert(html.includes('data-a33-home-access-form hidden'));
assert(html.includes('/assets/css/a33-home-access.css?v=4.20.98&r=1'));
assert(html.includes('/assets/js/a33-home-access.js?v=4.20.98&r=1'));

assert(homeAccess.includes("showPanel('Verificando acceso…'"));
assert(homeAccess.includes('g.A33Access.evaluateModuleAccess(card.dataset.a33ModuleTarget, current, { enforcementEnabled:true })'));
assert(homeAccess.includes("canSignIn ? 'Inicia sesión' : 'Acceso no disponible'"));
assert(homeAccess.includes("auth.ready === true && auth.status === 'ready'"));
assert(homeAccess.includes('await g.A33FirebaseAuth.signIn(email.value, password.value);'));
assert(homeAccess.includes('await g.A33FirebaseAuth.signOut();'));
assert(homeAccess.includes("showPanel('No se pudo verificar el acceso'"));

const sandbox = { console, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(accessSource, sandbox, { filename:'a33-firebase-access.js' });
const access = sandbox.A33Access;
const roles = access.getRoleOptions();
const modules = access.getModuleOptions();
function state(role){
  const definition = roles.find((item) => item.key === role);
  return { user:{uid:role}, profile:{role,status:'active'}, role, permissions:Array.from(definition.permissions) };
}
const adminVisible = targets.filter((target) => access.evaluateModuleAccess(target, state('admin'), { enforcementEnabled:true }).allowed);
const userVisible = targets.filter((target) => access.evaluateModuleAccess(target, state('usuario'), { enforcementEnabled:true }).allowed);
assert.equal(adminVisible.length, 13, 'Admin debe ver las 13 tarjetas.');
assert.equal(userVisible.length, 12, 'Usuario debe ver 12 tarjetas: 11 módulos y dos accesos de Finanzas.');
assert(!userVisible.includes('configuracion'), 'Usuario no debe ver Configuración.');
assert.equal(modules.length, 12);

console.log('OK — E10.2 filtra Inicio: Admin 13 tarjetas y Usuario 12 sin Configuración.');
