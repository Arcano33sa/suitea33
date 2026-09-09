const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-auth.js'), 'utf8');
const guard = fs.readFileSync(path.join(root, 'assets/js/a33-module-guard.js'), 'utf8');
const guardedPages = [
  'analitica/index.html',
  'finanzas/index.html',
  'centro-mando/index.html',
  'catalogos/index.html',
  'pos/index.html',
  'inventario/index.html',
  'calculadora/index.html',
  'calculadora_temporal/index.html',
  'agenda/index.html',
  'lotes/index.html',
  'pedidos/index.html',
  'configuracion/index.html'
];

assert(
  source.includes('return await new Promise(function(resolve){'),
  'Auth debe esperar la primera notificación de onAuthStateChanged.'
);
assert(
  source.includes('if (initialStatePending){') && source.includes('resolve(next);'),
  'La hidratación inicial debe resolverse con el estado confirmado por Firebase.'
);
assert(
  !source.includes("setState({ ready:true, status:auth.currentUser ? 'authenticated' : 'ready'"),
  'Auth no debe publicar auth.currentUser antes de que Firebase restaure la sesión.'
);
assert(
  source.includes("setState({ ready:true, status:'authenticated', mode:'firebase-auth', user:publicUser(user)"),
  'El inicio de sesión debe publicar el usuario autenticado antes de devolver el control.'
);
assert(
  guard.includes('await ensureAccess();') && guard.includes('const result = simulate(moduleId(), g.A33Access.getState());'),
  'La guarda debe esperar Auth/Access antes de evaluar el módulo actual.'
);
assert(
  guard.includes("'/assets/js/a33-firebase-auth.js?v=4.20.98&r=18'"),
  'La guarda debe solicitar la revisión nueva del runtime de Auth.'
);
guardedPages.forEach((file) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert(
    html.includes('a33-module-guard.js?v=4.20.98') && /a33-module-guard\.js\?v=4\.20\.98(?:&|&amp;)r=5/.test(html),
    `${file} debe cargar la revisión nueva de la guarda.`
  );
});

console.log('OK a33-firebase-auth-hydration-etapa9-5b1.smoke');
