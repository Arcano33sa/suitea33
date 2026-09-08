const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const accessSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-access.js'), 'utf8');
const guardSource = fs.readFileSync(path.join(root, 'assets/js/a33-module-guard.js'), 'utf8');
const activationSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-security-activate-e84c.js'), 'utf8');
const configHtml = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const sandbox = { globalThis:null, Promise, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.runInNewContext(accessSource, sandbox);
vm.runInNewContext(guardSource, sandbox);
vm.runInNewContext(activationSource, sandbox);

const modules = sandbox.A33Access.getModuleOptions();
const roles = sandbox.A33Access.getRoleOptions().map((role) => {
  const candidate = { user:{uid:role.key}, profile:{role:role.key,status:'active'}, role:role.key, permissions:role.permissions.slice() };
  const results = modules.map((module) => sandbox.A33ModuleGuard.simulate(module.key, candidate));
  const allowedCount = results.filter((result) => result.allowed).length;
  return { key:role.key, label:role.label, allowedCount, deniedCount:results.length - allowedCount, recoveryReady:role.key === 'admin' && results.every((result) => result.allowed && result.reason === 'admin-recovery') };
});
const pages = modules.map((module) => ({id:module.key, guardActive:true, headerMatches:true}));
const master = { user:{uid:'master'}, profile:{role:'admin',status:'active'}, role:'admin', isAdmin:true, permissions:[] };
const unknownResult = sandbox.A33ModuleGuard.simulate('__unknown__', master);
const inactiveResult = sandbox.A33ModuleGuard.simulate('analitica', { user:{uid:'inactive'}, profile:{role:'consulta',status:'inactive'}, role:'consulta', permissions:['reports.view'] });
const result = sandbox.A33SecurityActivationE84C.validate({ access:master, guardState:sandbox.A33ModuleGuard.getState(), pages, roleMatrix:roles, unknownResult, inactiveResult });

assert.equal(result.stage, 'E8.4C');
assert.equal(result.readOnly, true);
assert.equal(result.activationAudit, true);
assert.equal(result.pageCount, 12);
assert.equal(result.activeGuardCount, 12);
assert.equal(result.roleCount, 2);
assert.equal(result.checkCount, 26);
assert.equal(result.adminRecoveryReady, true);
assert.equal(result.unknownRouteBlocked, true);
assert.equal(result.inactiveProfileBlocked, true);
assert.equal(result.enforcementEnabled, true);
assert.equal(result.completed, true);
assert.deepEqual(Array.from(roles, (role) => role.allowedCount), [12, 11]);

const noRecovery = sandbox.A33SecurityActivationE84C.validate({ access:{}, guardState:{enforcementEnabled:true}, pages, roleMatrix:roles, unknownResult, inactiveResult });
assert.equal(noRecovery.completed, false);

const canonicalPages = [
  ['produccion','calculadora/index.html'], ['lotes','lotes/index.html'], ['inventario','inventario/index.html'],
  ['pos','pos/index.html'], ['analitica','analitica/index.html'], ['pedidos','pedidos/index.html'],
  ['finanzas','finanzas/index.html'], ['catalogos','catalogos/index.html'], ['agenda','agenda/index.html'],
  ['centro-mando','centro-mando/index.html'], ['configuracion','configuracion/index.html'], ['temporal','calculadora_temporal/index.html']
];
canonicalPages.forEach(([id, file]) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert(html.includes(`data-a33-module="${id}"`), `${file} no declara ${id}.`);
  assert(/a33-module-guard\.js\?v=4\.20\.98(?:&amp;|&)r=4/.test(html), `${file} no carga la guarda activa E8.4C.`);
});

['.set(', '.add(', '.update(', '.delete(', '.commit(', 'httpsCallable', 'localStorage.setItem'].forEach((token) => {
  assert.equal(activationSource.includes(token), false, `E8.4C contiene una escritura no permitida: ${token}`);
});
assert(guardSource.includes('const ENFORCEMENT_ENABLED = true;'), 'E8.4C no activó la compuerta.');
assert(guardSource.includes('verifyCurrentModule'), 'La guarda no protege el acceso directo.');
assert(guardSource.includes('simulate(target, g.A33Access.getState())'), 'El menú no usa la política activa E8.4C.');
assert(guardSource.includes('Acceder como Maestro'), 'Configuración no conserva la recuperación autenticable.');
assert(guardSource.includes('child.inert = true'), 'El contenido restringido sigue disponible para interacción por teclado.');
assert(configHtml.includes('id="cfg-security-e84c-run"'), 'No existe el botón E8.4C.');
assert(configHtml.includes('a33-firebase-security-activate-e84c.js?v=4.20.98&amp;r=2'), 'No se cargó la auditoría E8.4C.');
assert(configScript.includes('function initSecurityActivationE84C()'), 'No se inicializa E8.4C.');
assert(configScript.includes('initSecurityActivationE84C();'), 'E8.4C no se activa al cargar Configuración.');

console.log('OK a33-firebase-security-etapa8-4c.smoke');
