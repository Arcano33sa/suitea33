const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const accessSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-access.js'), 'utf8');
const guardSource = fs.readFileSync(path.join(root, 'assets/js/a33-module-guard.js'), 'utf8');
const testSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-security-test-e84b.js'), 'utf8');
const configHtml = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const sandbox = { globalThis:null, Promise, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.runInNewContext(accessSource, sandbox);
vm.runInNewContext(guardSource, sandbox);
vm.runInNewContext(testSource, sandbox);

const modules = sandbox.A33Access.getModuleOptions();
const roles = sandbox.A33Access.getRoleOptions().map((role) => {
  const access = { user:{uid:role.key}, profile:{role:role.key,status:'active'}, role:role.key, permissions:role.permissions.slice() };
  const results = modules.map((module) => sandbox.A33ModuleGuard.simulate(module.key, access));
  return {
    key:role.key,
    label:role.label,
    allowedCount:results.filter((result) => result.allowed).length,
    deniedCount:results.filter((result) => !result.allowed).length,
    recoveryReady:role.key === 'admin' && results.every((result) => result.allowed && result.reason === 'admin-recovery')
  };
});
const unknownResult = sandbox.A33ModuleGuard.simulate('__unknown__', { user:{uid:'master'}, profile:{role:'admin',status:'active'}, role:'admin', permissions:[] });
const inactiveResult = sandbox.A33ModuleGuard.simulate('analitica', { user:{uid:'inactive'}, profile:{role:'consulta',status:'inactive'}, role:'consulta', permissions:['reports.view'] });
const result = sandbox.A33SecurityTestE84B.validate({
  installation:{stage:'E8.4A',readyForE84B:true}, roles, moduleCount:modules.length,
  guardState:{enforcementEnabled:false}, unknownResult, inactiveResult
});

assert.equal(result.stage, 'E8.4B');
assert.equal(result.simulationOnly, true);
assert.equal(result.readOnly, true);
assert.equal(result.roleCount, 4);
assert.equal(result.moduleCount, 12);
assert.equal(result.checkCount, 50);
assert.equal(result.adminRecoveryReady, true);
assert.equal(result.unknownRouteBlocked, true);
assert.equal(result.inactiveProfileBlocked, true);
assert.equal(result.enforcementEnabled, false);
assert.equal(result.readyForE84C, true);
assert.deepEqual(Array.from(roles, (role) => role.allowedCount), [12, 9, 4, 3]);

const activated = sandbox.A33SecurityTestE84B.validate({
  installation:{stage:'E8.4A',readyForE84B:true}, roles, moduleCount:12,
  guardState:{enforcementEnabled:true}, unknownResult, inactiveResult
});
assert.equal(activated.readyForE84C, false);

['.set(', '.add(', '.update(', '.delete(', '.commit(', 'httpsCallable', 'localStorage.setItem'].forEach((token) => {
  assert.equal(testSource.includes(token), false, `E8.4B contiene una operación no permitida: ${token}`);
});
assert(guardSource.includes('function simulate(target, accessOverride)'), 'La vía de prueba controlada E8.4B no está disponible.');
assert(configHtml.includes('id="cfg-security-e84b-run"'), 'No existe el botón E8.4B.');
assert(configHtml.includes('a33-firebase-security-test-e84b.js?v=4.20.98&amp;r=1'), 'No se cargó la prueba E8.4B.');
assert(configScript.includes('function initSecurityTestE84B()'), 'No se inicializa E8.4B.');
assert(configScript.includes('initSecurityTestE84B();'), 'E8.4B no se activa al cargar Configuración.');

console.log('OK a33-firebase-security-etapa8-4b.smoke');
