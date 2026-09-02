const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-security-simulate-e82.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const sandbox = { globalThis:null };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);

const modules = [
  { id:'configuracion', label:'Configuración', permission:'config.view', allowedRoles:['admin'] },
  { id:'pos', label:'POS y ventas', permission:'sales.use', allowedRoles:['admin','ventas'] },
  { id:'finanzas', label:'Finanzas', permission:'finance.use', allowedRoles:['admin','finanzas'] },
  { id:'catalogos', label:'Catálogos', permission:'catalog.view', allowedRoles:['admin','ventas','finanzas','consulta'] }
];
const roles = [
  { key:'admin', label:'Admin' }, { key:'ventas', label:'Ventas' },
  { key:'finanzas', label:'Finanzas' }, { key:'consulta', label:'Consulta' }
];
const result = sandbox.A33SecuritySimulationE82.simulate({
  diagnostic:{ stage:'E8.1', readyForE82:true, workspaceId:'arcano33', moduleMatrix:modules },
  access:{ user:{ uid:'master-1' }, profile:{ uid:'master-1', role:'admin', status:'active' }, isAdmin:true },
  roles,
  moduleAccess:{ enforcementEnabled:false }
});
assert.equal(result.stage, 'E8.2');
assert.equal(result.simulationOnly, true);
assert.equal(result.readOnly, true);
assert.equal(result.readyForE83, true);
assert.equal(result.masterSafe, true);
assert.equal(result.adminFullAccess, true);
assert.equal(result.roleMatrix.find((role) => role.key === 'ventas').allowedCount, 2);

const unsafe = sandbox.A33SecuritySimulationE82.simulate({
  diagnostic:{ stage:'E8.1', readyForE82:true, workspaceId:'arcano33', moduleMatrix:modules },
  access:{ user:{ uid:'user-1' }, profile:{ uid:'user-1', role:'ventas', status:'active' }, isAdmin:false },
  roles,
  moduleAccess:{ enforcementEnabled:false }
});
assert.equal(unsafe.readyForE83, false);
assert(unsafe.issues.some((message) => message.includes('Admin activo')));

['.set(', '.add(', '.update(', '.delete(', '.commit(', 'httpsCallable', 'localStorage.setItem'].forEach((token) => {
  assert.equal(source.includes(token), false, `E8.2 contiene una operación no permitida: ${token}`);
});
assert(html.includes('id="cfg-security-e82-run"'), 'No existe el botón E8.2.');
assert(html.includes('a33-firebase-security-simulate-e82.js?v=4.20.98&amp;r=1'), 'No se cargó la simulación E8.2.');
assert(html.indexOf('cfg-security-e81-title') < html.indexOf('cfg-security-e82-title'), 'E8.2 no quedó después de E8.1.');
assert(configScript.includes('function initSecuritySimulationE82()'), 'No se inicializa E8.2.');
assert(configScript.includes('initSecuritySimulationE82();'), 'E8.2 no se activa al cargar Configuración.');

console.log('OK a33-firebase-security-etapa8-2.smoke');
