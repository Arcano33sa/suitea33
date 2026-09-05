const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-users-hardening-e92.js'), 'utf8');
const functionsSource = fs.readFileSync(path.join(root, 'functions/src/index.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const sandbox = {globalThis:null}; sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);

const safeguards = ['workspace-canónico','admin-vigente','pertenencia-uid','último-admin','bootstrap-exclusivo','contraseña-segura','archivo-previo-a-baja'];
const result = sandbox.A33UsersHardeningE92.validate({
  access:{user:{uid:'master'},profile:{status:'active'},role:'admin',isAdmin:true,workspaceId:'arcano33',backendMode:'spark-manual',managementReady:false,canBootstrap:false},
  guardState:{enforcementEnabled:true}, safeguards
});
assert.equal(result.stage, 'E9.2');
assert.equal(result.readOnly, true);
assert.equal(result.administrationEnabled, false);
assert.equal(result.safeguardCount, 7);
assert.equal(result.completed, true);
assert.equal(sandbox.A33UsersHardeningE92.validate({access:{},guardState:{},safeguards:[]}).completed, false);

assert(functionsSource.includes("const crypto = require('node:crypto')"));
assert(functionsSource.includes("const DEFAULT_WORKSPACE_ID = 'arcano33'"));
assert(functionsSource.includes('crypto.randomInt(0, alphabet.length)'));
assert(functionsSource.includes("throw new HttpsError('not-found', 'El usuario no pertenece al workspace administrado.')"));
assert(functionsSource.includes("memberData.uid !== authContext.uid || memberData.workspaceId !== workspaceId"));
assert(functionsSource.includes("doc.id !== uid && data.role === 'admin' && data.status === 'active'"));
assert(functionsSource.includes("throw new HttpsError('permission-denied', 'No puedes consultar otro workspace.')"));
assert(functionsSource.includes("throw new HttpsError('permission-denied', 'No puedes inicializar otro workspace.')"));
assert.equal(functionsSource.includes('Math.random()'), false);

['.set(', '.add(', '.update(', '.delete(', '.commit(', 'httpsCallable', 'localStorage.setItem'].forEach((token) => assert.equal(source.includes(token), false));
assert(html.includes('id="cfg-security-e92-run"'));
assert(html.includes('a33-firebase-users-hardening-e92.js?v=4.20.98&amp;r=1'));
assert(script.includes('function initUsersHardeningE92()'));
assert(script.includes('initUsersHardeningE92();'));
console.log('OK a33-firebase-users-etapa9-2.smoke');
