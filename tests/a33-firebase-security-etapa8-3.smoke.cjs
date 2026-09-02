const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-security-prepare-e83.js'), 'utf8');
const accessSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-access.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(root, 'assets/js/a33-module-access.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const navSource = fs.readFileSync(path.join(root, 'assets/js/a33-module-nav.js'), 'utf8');
const sandbox = { globalThis:null };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);

const ids = ['produccion','lotes','inventario','pos','analitica','pedidos','finanzas','catalogos','agenda','centro-mando','configuracion','temporal'];
const modules = ids.map((key) => ({ key, label:key, permission:`${key}.use` }));
const navModules = ids.map((id) => ({ id }));
const result = sandbox.A33SecurityPreparationE83.prepare({
  simulation:{ stage:'E8.2', readyForE83:true },
  access:{ user:{uid:'master'}, profile:{role:'admin',status:'active'}, role:'admin', isAdmin:true, workspaceId:'arcano33' },
  modules, navModules,
  moduleState:{ enforcementEnabled:false },
  recoveryResults:modules.map(() => ({ allowed:true, reason:'admin-recovery' }))
});
assert.equal(result.stage, 'E8.3');
assert.equal(result.preparationOnly, true);
assert.equal(result.readOnly, true);
assert.equal(result.readyForE84, true);
assert.equal(result.moduleCount, 12);
assert.equal(result.recoveryReady, true);

const mismatch = sandbox.A33SecurityPreparationE83.prepare({
  simulation:{ stage:'E8.2', readyForE83:true },
  access:{ user:{uid:'master'}, profile:{role:'admin',status:'active'}, role:'admin', isAdmin:true },
  modules:modules.slice(1), navModules,
  moduleState:{ enforcementEnabled:false },
  recoveryResults:modules.slice(1).map(() => ({ allowed:true, reason:'admin-recovery' }))
});
assert.equal(mismatch.readyForE84, false);
assert(mismatch.missingPolicy.includes('produccion'));

['.set(', '.add(', '.update(', '.delete(', '.commit(', 'httpsCallable', 'localStorage.setItem'].forEach((token) => {
  assert.equal(source.includes(token), false, `E8.3 contiene una operación no permitida: ${token}`);
});
assert(accessSource.includes("{ key:'produccion', label:'Producción', permission:'production.use' }"), 'Producción no usa el identificador canónico del menú.');
assert(accessSource.includes("{ key:'temporal', label:'Temporal', permission:'sandbox.use' }"), 'Temporal no tiene política explícita.');
assert(moduleSource.includes('const ENFORCEMENT_ENABLED = false;'), 'E8.3 activó indebidamente la compuerta.');
assert(accessSource.includes("reason:'admin-recovery'"), 'La recuperación Admin no está preparada.');
ids.forEach((id) => assert(navSource.includes(`id: '${id}'`), `El menú no contiene ${id}.`));
assert(html.includes('id="cfg-security-e83-run"'), 'No existe el botón E8.3.');
assert(html.includes('a33-firebase-security-prepare-e83.js?v=4.20.98&amp;r=1'), 'No se cargó la prevalidación E8.3.');
assert(configScript.includes('function initSecurityPreparationE83()'), 'No se inicializa E8.3.');
assert(configScript.includes('initSecurityPreparationE83();'), 'E8.3 no se activa al cargar Configuración.');

console.log('OK a33-firebase-security-etapa8-3.smoke');
