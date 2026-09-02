const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-security-diagnostic-e81.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const sandbox = { globalThis:null };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);

const roles = [
  { key:'admin', label:'Admin', permissions:['config.view','sales.use','agenda.use','finance.use','inventory.use','production.use','lots.use','pedidos.use','center.view','catalog.view'] },
  { key:'consulta', label:'Consulta', permissions:['center.view','catalog.view'] }
];
const healthy = sandbox.A33SecurityDiagnosticE81.diagnose({
  access:{ user:{ uid:'master-1' }, profile:{ uid:'master-1', workspaceId:'arcano33', role:'admin', status:'active' }, workspaceId:'arcano33', isAdmin:true },
  users:[{ uid:'master-1', workspaceId:'arcano33', name:'Maestro', email:'maestro@example.com', role:'admin', status:'active' }],
  roles,
  moduleAccess:{ enforcementEnabled:false }
});
assert.equal(healthy.stage, 'E8.1');
assert.equal(healthy.readOnly, true);
assert.equal(healthy.readyForE82, true);
assert.equal(healthy.activeAdminCount, 1);
assert.equal(healthy.moduleCount, 10);
assert.equal(healthy.enforcementEnabled, false);

const blocked = sandbox.A33SecurityDiagnosticE81.diagnose({
  access:{ user:{ uid:'master-1' }, profile:null, workspaceId:'arcano33', isAdmin:false },
  users:[], roles, moduleAccess:{ enforcementEnabled:false }
});
assert.equal(blocked.readyForE82, false);
assert(blocked.issues.some((item) => item.code === 'profile-missing'));
assert(blocked.issues.some((item) => item.code === 'active-admin-missing'));

['.set(', '.add(', '.update(', '.delete(', '.commit(', 'httpsCallable'].forEach((token) => {
  assert.equal(source.includes(token), false, `E8.1 contiene una operación no permitida: ${token}`);
});
assert(html.includes('id="cfg-security-e81-run"'), 'No existe el botón E8.1.');
assert(html.includes('a33-firebase-security-diagnostic-e81.js?v=4.20.98&amp;r=1'), 'No se cargó el diagnóstico E8.1.');
assert(configScript.includes('function initSecurityDiagnosticE81()'), 'No se inicializa E8.1.');
assert(configScript.includes('initSecurityDiagnosticE81();'), 'E8.1 no se activa al cargar Configuración.');
assert(html.indexOf('cfg-security-e81-title') < html.indexOf('cfg-user-count-total'), 'E8.1 no quedó antes del listado operativo de usuarios.');

console.log('OK a33-firebase-security-etapa8-1.smoke');
