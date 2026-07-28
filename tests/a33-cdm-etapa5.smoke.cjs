'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('centro-mando/index.html');
const css = read('centro-mando/style.css');
const app = read('centro-mando/app.js');
const sw = read('centro-mando/sw.js');
const manifest = JSON.parse(read('centro-mando/manifest.webmanifest'));
const legacyIndex = read('centro_mando/index.html');
const legacySw = read('centro_mando/sw.js');

const requiredOrder = [
  'operationalHeader',
  'todaySummaryBlock',
  'attentionBlock',
  'ordersBlock',
  'agendaBlock',
  'inventoryBlock',
  'globalActivesBlock'
];
const positions = requiredOrder.map((id) => index.indexOf(`id="${id}"`));
assert(positions.every((pos) => pos >= 0), 'Falta un bloque obligatorio');
for (let i = 1; i < positions.length; i += 1) {
  assert(positions[i] > positions[i - 1], `Orden incorrecto: ${requiredOrder[i]}`);
}

assert(/\.cmd-main\s*\{[\s\S]*?width:100%/m.test(css), 'Main no ocupa ancho disponible');
assert(/\.cmd-block\s*\{[\s\S]*?width:100%/m.test(css), 'Bloques no están a ancho completo');
assert(/overflow-x:hidden/.test(css), 'Falta blindaje de scroll horizontal');
assert(/overscroll-behavior-x:none/.test(css), 'Falta hardening de desbordamiento horizontal');
assert(/touch-action:manipulation/.test(css), 'Falta mitigación de zoom táctil accidental');
assert(/\.cmd-input\{ font-size:16px; \}/.test(css), 'Falta font-size 16px en input móvil');
assert(/@media \(max-width:820px\)/.test(css), 'Falta responsive iPad/tablet');
assert(/@media \(max-width:560px\)/.test(css), 'Falta responsive móvil');
assert(/orientation:landscape/.test(css), 'Falta hardening de orientación horizontal');
assert(/prefers-reduced-motion/.test(css), 'Falta accesibilidad de movimiento reducido');
assert(/:root,\s*html\[data-theme="dark"\]/.test(css), 'Tema oscuro no está definido como base segura');
assert(/html\[data-theme="light"\]/.test(css), 'Tema claro global no está soportado');
assert(css.includes('--cmd-card:#111111'), 'Superficie oscura principal incorrecta');
assert(css.includes('--cmd-control:#141414'), 'Controles oscuros no definidos');
assert(!/background:#fff;/.test(css), 'Persisten fondos blancos fijos fuera del sistema de tema');
assert(app.includes('function refreshAppearance()'), 'Falta reaplicación robusta de Apariencia');


assert(index.includes('rel="manifest" href="manifest.webmanifest?v=4.20.97&r=5"'), 'Manifest no enlazado');
assert(index.includes('style.css?v=4.20.97&r=18'), 'Revisión CSS final incorrecta');
assert(index.includes('app.js?v=4.20.97&r=22'), 'Revisión app final incorrecta');
assert(app.includes("navigator.serviceWorker.register(swUrl, { scope:'./', updateViaCache:'none' })"), 'Registro SW robusto ausente');
assert(app.includes('window.__A33_CDM_STAGE5'), 'Diagnóstico Etapa 5 ausente');

assert.strictEqual(manifest.start_url, './index.html?v=4.20.97&r=22', 'start_url PWA incorrecto');
assert.strictEqual(manifest.scope, './', 'scope PWA incorrecto');
assert.strictEqual(manifest.display, 'standalone', 'display PWA incorrecto');
assert.strictEqual(manifest.orientation, 'any', 'PWA debe aceptar cambio de orientación');
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'Iconos PWA incompletos');
for (const icon of manifest.icons) {
  const iconPath = path.resolve(root, 'centro-mando', icon.src);
  assert(fs.existsSync(iconPath), `Icono PWA ausente: ${icon.src}`);
}
assert(fs.existsSync(path.join(root, 'centro-mando/offline.html')), 'Fallback offline ausente');

assert(sw.includes("const MODULE = 'centro-mando'"), 'SW no está acotado al módulo');
assert(sw.includes("const MODULE_CACHE_REV = '5'"), 'Cache revision final ausente');
assert(sw.includes("'./style.css?v=4.20.97&r=18'"), 'CSS final no precacheado');
assert(sw.includes("'./app.js?v=4.20.97&r=22'"), 'App final no precacheada');
assert(sw.includes("'./offline.html'"), 'Offline no precacheado');
assert(sw.includes('await self.skipWaiting()'), 'SW nuevo no activa actualización');
assert(sw.includes('await self.clients.claim()'), 'SW no reclama clientes tras actualización');
assert(sw.includes('isCriticalAsset'), 'SW no usa estrategia anti-caché fantasma');

assert(!legacyIndex.includes("k.indexOf('centro-mando') >= 0"), 'Ruta legacy borra el cache oficial nuevo');
assert(!legacySw.includes("'centro-mando'"), 'SW legacy borra el cache oficial nuevo');
assert(legacyIndex.includes('../centro-mando/index.html'), 'Ruta legacy no redirige a ruta oficial');

const forbidden = /checklist|recordatorio|recomendaci[oó]n|top productos|mini radar/i;
assert(!forbidden.test(index), 'Contenido heredado prohibido en HTML');
assert(!forbidden.test(app), 'Contenido heredado prohibido en JS');

const currentEventWrites = [...app.matchAll(/setMetaValue\('currentEventId'/g)].length;
assert.strictEqual(currentEventWrites, 1, 'Debe existir una sola escritura explícita al evento activo POS');
assert(app.includes("if (state.visualMode === MODE_GLOBAL)"), 'Falta control GLOBAL');
assert(app.includes("setHidden('globalActivesBlock', true)"), 'Eventos activos no se ocultan fuera de GLOBAL');

console.log('ETAPA 5 SMOKE OK');
console.log('- Orden final y bloques full-width verificados');
console.log('- Responsive escritorio/iPad/móvil, tactilidad y orientación verificados');
console.log('- PWA, offline, revisión de caché y estrategia anti-fantasmas verificados');
console.log('- Tema oscuro/claro global y superficies sin blancos fijos verificados');
console.log('- Ruta legacy blindada para no borrar el caché oficial');
console.log('- Contenido heredado prohibido ausente y separación POS preservada');
