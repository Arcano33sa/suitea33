const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const guard = fs.readFileSync(path.join(root, 'assets/js/a33-module-guard.js'), 'utf8');
const guardedPages = [
  'analitica/index.html', 'finanzas/index.html', 'centro-mando/index.html',
  'catalogos/index.html', 'pos/index.html', 'inventario/index.html',
  'calculadora/index.html', 'calculadora_temporal/index.html', 'agenda/index.html',
  'lotes/index.html', 'pedidos/index.html', 'configuracion/index.html'
];

assert(guard.includes('renderRecoveryForm(node);'), 'La guarda bloqueada debe mostrar inicio de sesión local.');
assert(!guard.includes("login.href = '/configuracion/index.html'"), 'Un módulo no debe redirigir a Configuración para iniciar sesión.');
assert(
  guard.includes("moduleId() === 'configuracion' ? 'Acceder como Maestro' : 'Iniciar sesión'"),
  'La etiqueta debe distinguir recuperación Admin e inicio de Usuario.'
);
assert(
  guard.includes('await g.A33FirebaseAuth.signIn') && guard.includes('await verifyCurrentModule();'),
  'La guarda debe reevaluar y desbloquear el mismo módulo después del login.'
);
assert(
  guard.includes('let authenticationInProgress = false;') &&
    guard.includes('if (!authenticationInProgress) verifyCurrentModule();'),
  'La guarda no debe reconstruir el formulario mientras Authentication responde.'
);
assert(
  guard.includes('authenticationInProgress = true;') &&
    guard.includes('authenticationInProgress = false;\n        await verifyCurrentModule();'),
  'El ciclo de autenticación debe cerrarse antes de reevaluar el módulo.'
);

for (const file of guardedPages) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert(/a33-module-guard\.js\?v=4\.20\.98(?:&|&amp;)r=5/.test(html), `${file} no carga la guarda r5.`);
}

console.log('OK — E9.5B-R3.1 inicia sesión y desbloquea directamente el módulo permitido.');
