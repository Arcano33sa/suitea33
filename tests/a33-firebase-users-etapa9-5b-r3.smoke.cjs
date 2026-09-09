const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const configHtml = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const functionsSource = fs.readFileSync(path.join(root, 'functions/src/index.js'), 'utf8');
const rulesSource = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

const roleSelect = configHtml.match(/<select class="cfg-input" id="cfg-user-role"[\s\S]*?<\/select>/)?.[0] || '';
assert(roleSelect.includes('<option value="admin">Admin</option>'));
assert(roleSelect.includes('<option value="usuario">Usuario</option>'));
for (const legacyRole of ['ventas', 'finanzas', 'consulta']) {
  assert(!roleSelect.includes(`value="${legacyRole}"`), `El formulario todavía ofrece el rol legado ${legacyRole}.`);
  assert(functionsSource.includes(`${legacyRole}: 'usuario'`), `Falta migración compatible de ${legacyRole} a usuario.`);
}

assert(configScript.includes("usuario: { label: 'Usuario' }"));
assert(!configScript.includes("const USER_ROLE_META = {\n    admin: { label: 'Admin' },\n    ventas:"));
assert(functionsSource.includes("const BACKEND_VERSION = '2026.09.08-e9.5b-r3';"));
assert(functionsSource.includes("role === 'admin'"), 'El backend debe conservar la protección del Admin Maestro.');
assert(rulesSource.includes("role == 'usuario'"), 'Las reglas deben reconocer el rol canónico usuario.');

console.log('OK — E9.5B-R3 deja solo Admin/Usuario en el formulario y conserva aliases de migración.');
