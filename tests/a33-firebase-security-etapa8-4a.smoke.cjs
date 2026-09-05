const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const auditSource = fs.readFileSync(path.join(root, 'assets/js/a33-firebase-security-guards-e84a.js'), 'utf8');
const guardSource = fs.readFileSync(path.join(root, 'assets/js/a33-module-guard.js'), 'utf8');
const configHtml = fs.readFileSync(path.join(root, 'configuracion/index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'configuracion/script.js'), 'utf8');
const sandbox = { globalThis:null };
sandbox.globalThis = sandbox;
vm.runInNewContext(auditSource, sandbox);

const pages = sandbox.A33SecurityGuardsE84A.pages().map(([id, pagePath]) => ({
  id,
  path:pagePath,
  guardInstalled:true,
  headerMatches:true
}));
const result = sandbox.A33SecurityGuardsE84A.validate({
  preparation:{ stage:'E8.3', readyForE84:true },
  pages,
  guardState:{ enforcementEnabled:false }
});
assert.equal(result.stage, 'E8.4A');
assert.equal(result.preparationOnly, true);
assert.equal(result.readOnly, true);
assert.equal(result.pageCount, 12);
assert.equal(result.installedCount, 12);
assert.equal(result.enforcementEnabled, false);
assert.equal(result.readyForE84B, true);

const missing = sandbox.A33SecurityGuardsE84A.validate({
  preparation:{ stage:'E8.3', readyForE84:true },
  pages:pages.map((page, index) => index === 0 ? { ...page, guardInstalled:false } : page),
  guardState:{ enforcementEnabled:false }
});
assert.equal(missing.readyForE84B, false);
assert.deepEqual(Array.from(missing.missing), ['produccion']);

const canonicalPages = [
  ['produccion','calculadora/index.html'], ['lotes','lotes/index.html'], ['inventario','inventario/index.html'],
  ['pos','pos/index.html'], ['analitica','analitica/index.html'], ['pedidos','pedidos/index.html'],
  ['finanzas','finanzas/index.html'], ['catalogos','catalogos/index.html'], ['agenda','agenda/index.html'],
  ['centro-mando','centro-mando/index.html'], ['configuracion','configuracion/index.html'], ['temporal','calculadora_temporal/index.html']
];
canonicalPages.forEach(([id, file]) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert(html.includes(`data-a33-module="${id}"`), `${file} no declara el módulo ${id}.`);
  assert(/a33-module-guard\.js\?v=4\.20\.98(?:&amp;|&)r=1/.test(html), `${file} no carga la guarda E8.4A.`);
});

['.set(', '.add(', '.update(', '.delete(', '.commit(', 'httpsCallable', 'localStorage.setItem'].forEach((token) => {
  assert.equal(auditSource.includes(token), false, `E8.4A contiene una operación no permitida: ${token}`);
  assert.equal(guardSource.includes(token), false, `La guarda E8.4A contiene una operación no permitida: ${token}`);
});
assert(guardSource.includes('const ENFORCEMENT_ENABLED = false;'), 'E8.4A activó indebidamente la compuerta.');
assert(guardSource.includes("reason:'guard-disabled'"), 'La guarda no conserva navegación abierta mientras está apagada.');
assert(configHtml.includes('id="cfg-security-e84a-run"'), 'No existe el botón E8.4A.');
assert(configHtml.includes('a33-firebase-security-guards-e84a.js?v=4.20.98&amp;r=1'), 'No se cargó la auditoría E8.4A.');
assert(configScript.includes('function initSecurityGuardsE84A()'), 'No se inicializa E8.4A.');
assert(configScript.includes('initSecurityGuardsE84A();'), 'E8.4A no se activa al cargar Configuración.');

console.log('OK a33-firebase-security-etapa8-4a.smoke');
