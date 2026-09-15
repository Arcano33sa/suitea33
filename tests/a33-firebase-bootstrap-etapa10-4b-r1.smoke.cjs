const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-config.js'), 'utf8');

function load(storedValue) {
  const data = new Map();
  if (storedValue !== undefined) data.set('suite_a33_firebase_settings_v1', JSON.stringify(storedValue));
  const sandbox = {
    console,
    URL,
    localStorage: {
      getItem(key) { return data.has(key) ? data.get(key) : null; },
      setItem(key, value) { data.set(key, String(value)); }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'a33-firebase-config.js' });
  return sandbox.A33FirebaseSettings;
}

const fresh = load().read();
assert.equal(fresh.enabled, true, 'Firebase debe iniciar activo en un origen nuevo.');
assert.equal(fresh.configured, true, 'La configuración web pública debe estar completa.');
assert.equal(fresh.workspaceId, 'arcano33');
assert.equal(fresh.credentials.projectId, 'suitea33-b0c34');
assert.equal(fresh.credentials.authDomain, 'suitea33-b0c34.firebaseapp.com');
assert.equal(fresh.credentials.appId, '1:657807672337:web:15da8bbeea23fbc2805db0');
assert(fresh.credentials.apiKey.startsWith('AIza'), 'Falta la API key web pública.');

const disabled = load({ ...fresh, enabled: false }).read();
assert.equal(disabled.enabled, false, 'Una desactivación local explícita debe conservarse.');

const custom = load({
  ...fresh,
  credentials: { ...fresh.credentials, authDomain: 'custom.example.test' }
}).read();
assert.equal(custom.credentials.authDomain, 'custom.example.test', 'La configuración local debe prevalecer.');

const cleared = load({ ...fresh, credentials: {} }).read();
assert.equal(cleared.configured, false, 'Limpiar credenciales localmente debe seguir siendo posible.');

const guard = fs.readFileSync(path.join(root, 'assets/js/a33-module-guard.js'), 'utf8');
const home = fs.readFileSync(path.join(root, 'assets/js/a33-home-access.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(guard.includes('/assets/js/a33-firebase-config.js?v=4.20.98&r=20'));
assert(home.includes('/assets/js/a33-firebase-config.js?v=4.20.98&r=20'));
assert(index.includes('/assets/js/a33-home-access.js?v=4.20.98&r=2'));

console.log('OK — E10.4B-R1 inicia Firebase en orígenes nuevos y conserva overrides locales.');
