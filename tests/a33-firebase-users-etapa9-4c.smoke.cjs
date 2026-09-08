const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'functions/src/index.js'), 'utf8');
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
const functionsPackage = JSON.parse(fs.readFileSync(path.join(root, 'functions/package.json'), 'utf8'));

const callables = [
  'a33AdminHealthcheck',
  'a33BootstrapWorkspaceAdmin',
  'a33AdminUpsertUser',
  'a33AdminDeleteUser'
];

callables.forEach((name) => {
  assert(source.includes(`exports.${name} = onCall({ invoker: 'public' }, async (request) => {`), `${name} no declara el invocador requerido.`);
});
assert.equal((source.match(/onCall\(\{ invoker: 'public' \}/g) || []).length, 4);
assert(source.includes("throw new HttpsError('unauthenticated'"));
assert(source.includes("throw new HttpsError('permission-denied'"));
assert.equal(firebaseConfig.functions.runtime, 'nodejs22');
assert.equal(functionsPackage.engines.node, '22');
assert.equal(functionsPackage.dependencies['@google-cloud/functions-framework'], '^5.0.5');

console.log('OK a33-firebase-users-etapa9-4c.smoke');
