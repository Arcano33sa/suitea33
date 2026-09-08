const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');

assert(app.includes('function canManageProtectedClosuresPOS(accessOverride)'), 'Falta la autorización central de cierres.');
assert(app.includes("profile.status === 'active' && role === 'admin'"), 'Los cierres no exigen Admin activo.');
assert(app.includes("requireProtectedClosurePOS('cerrar eventos')"), 'El cierre real de eventos no está protegido.');
assert.equal((app.match(/requireProtectedClosurePOS\('cerrar períodos'\)/g) || []).length, 2, 'Apertura y confirmación del cierre de período deben estar protegidas.');
assert(app.includes("document.querySelectorAll('#btn-close-event, .act-cerrar, #btn-summary-close-period, #summary-close-confirm')"), 'La interfaz no cubre todos los cierres acordados.');
assert(app.includes("window.addEventListener('a33:access-state'"), 'La interfaz no reacciona a cambios de perfil.');
assert(app.includes("document.addEventListener('DOMContentLoaded'"), 'La restricción no se aplica en la carga inicial.');
assert(!app.includes("#btn-summary-close-day, .act-cerrar"), 'El cierre diario no debe quedar incluido por accidente.');
assert(html.includes('app.js?v=4.20.98&r=53'), 'POS no carga la revisión R2 de app.js.');
assert(html.includes("-pos-r'+rev+'-m59"), 'POS no expone el caché R2 vigente.');
assert(sw.includes("const MODULE_CACHE_REV = '59';"), 'El caché POS no fue actualizado.');
assert(sw.includes("'./app.js?v=4.20.98&r=53'"), 'El service worker no precarga la revisión R2.');

const canStart = app.indexOf('function canManageProtectedClosuresPOS(accessOverride)');
const canEnd = app.indexOf('function requireProtectedClosurePOS', canStart);
assert(canStart >= 0 && canEnd > canStart, 'No se pudo aislar la política para probarla.');
const sandbox = { window:{ A33Access:null } };
vm.runInNewContext(app.slice(canStart, canEnd), sandbox);
const activeAdmin = { user:{uid:'admin'}, profile:{role:'admin',status:'active'}, role:'admin' };
const activeUser = { user:{uid:'user'}, profile:{role:'usuario',status:'active'}, role:'usuario' };
const inactiveAdmin = { user:{uid:'admin'}, profile:{role:'admin',status:'inactive'}, role:'admin' };
assert.equal(sandbox.canManageProtectedClosuresPOS(activeAdmin), true);
assert.equal(sandbox.canManageProtectedClosuresPOS(activeUser), false);
assert.equal(sandbox.canManageProtectedClosuresPOS(inactiveAdmin), false);
assert.equal(sandbox.canManageProtectedClosuresPOS({}), false);

console.log('OK a33-firebase-users-etapa9-5b-r2.smoke');
