const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const accessSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-access.js'), 'utf8');
const functionsSource = fs.readFileSync(path.join(root, 'functions/src/index.js'), 'utf8');
const rulesSource = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const configHtml = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const sandbox = { globalThis:null, Promise, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.runInNewContext(accessSource, sandbox);

const roles = sandbox.A33Access.getRoleOptions();
const modules = sandbox.A33Access.getModuleOptions();
assert.deepEqual(Array.from(roles, (role) => role.key), ['admin', 'usuario']);
assert.deepEqual(Array.from(roles, (role) => role.label), ['Admin', 'Usuario']);

const user = roles.find((role) => role.key === 'usuario');
const candidate = { user:{uid:'user'}, profile:{role:'usuario',status:'active'}, role:'usuario', permissions:user.permissions.slice() };
const results = Object.fromEntries(modules.map((module) => [module.key, sandbox.A33Access.evaluateModuleAccess(module.key, candidate, {enforcementEnabled:true})]));
assert.equal(results.configuracion.allowed, false);
assert.equal(results.configuracion.reason, 'permission-missing');
modules.filter((module) => module.key !== 'configuracion').forEach((module) => assert.equal(results[module.key].allowed, true, `Usuario no accede a ${module.key}.`));

['ventas', 'finanzas', 'consulta'].forEach((legacy) => {
  assert(accessSource.includes(`${legacy}:'usuario'`), `Falta compatibilidad local para ${legacy}.`);
  assert(functionsSource.includes(`${legacy}: 'usuario'`), `Falta compatibilidad backend para ${legacy}.`);
});
assert(functionsSource.includes("ROLE_DEFINITIONS.usuario.permissions"), 'El fallback backend no usa Usuario.');
assert(rulesSource.includes("role == 'usuario'"), 'Las reglas locales no preparan el rol Usuario.');
assert(configHtml.includes('a33-firebase-access.js?v=4.20.98&amp;r=18'), 'Configuración no carga la política R1.');
assert(configHtml.includes('a33-module-guard.js?v=4.20.98&amp;r=5'), 'Configuración no carga la guarda vigente.');

console.log('OK a33-firebase-users-etapa9-5b-r1.smoke');
