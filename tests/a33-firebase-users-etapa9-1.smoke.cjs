const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-users-diagnostic-e91.js'), 'utf8');
const configHtml = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
const functionsSource = fs.readFileSync(path.join(root, 'functions/src/index.js'), 'utf8');
const sandbox = { globalThis:null };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);

const result = sandbox.A33UsersDiagnosticE91.validate({
  access:{ user:{uid:'master'}, profile:{status:'active'}, role:'admin', isAdmin:true, workspaceId:'arcano33', backendMode:'spark-manual', managementReady:false, canBootstrap:false },
  profiles:[{uid:'master',role:'admin',status:'active'}],
  contracts:{saveUser:true,deleteUser:true,bootstrapAdmin:true},
  guardState:{enforcementEnabled:true}
});
assert.equal(result.stage, 'E9.1');
assert.equal(result.readOnly, true);
assert.equal(result.administrationEnabled, false);
assert.equal(result.profileCount, 1);
assert.equal(result.activeAdminCount, 1);
assert.equal(result.contractCount, 3);
assert.equal(result.completed, true);

const unsafe = sandbox.A33UsersDiagnosticE91.validate({ access:{backendMode:'functions',managementReady:true}, profiles:[], contracts:{}, guardState:{} });
assert.equal(unsafe.completed, false);
assert(unsafe.issues.length >= 5);

['.set(', '.add(', '.update(', '.delete(', '.commit(', 'httpsCallable', 'localStorage.setItem'].forEach((token) => {
  assert.equal(source.includes(token), false, `E9.1 contiene una escritura o invocación no permitida: ${token}`);
});
assert.equal(firebaseConfig.firestore.rules, 'firestore.rules');
['a33AdminUpsertUser', 'a33AdminDeleteUser', 'a33BootstrapWorkspaceAdmin'].forEach((name) => {
  assert(functionsSource.includes(`exports.${name} = onCall`), `Falta el contrato ${name}.`);
});
assert(configHtml.includes('id="cfg-security-e91-run"'));
assert(configHtml.includes('a33-firebase-users-diagnostic-e91.js?v=4.20.98&amp;r=1'));
assert(configScript.includes('function initUsersDiagnosticE91()'));
assert(configScript.includes('initUsersDiagnosticE91();'));

console.log('OK a33-firebase-users-etapa9-1.smoke');
