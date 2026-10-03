// Coherencia de versiones y precache: a33-publicacion-coherencia.smoke.cjs.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'calculadora/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'calculadora/sw.js'), 'utf8');

const pending = html.indexOf('id="a33-checklist-pendientes"');
const selected = html.indexOf('id="a33-checklist-seleccion"');
const history = html.indexOf('id="a33-checklist-historico"');

assert.ok(pending >= 0 && selected > pending && history > selected, 'El orden debe ser Pendientes, Checklist e Histórico');
assert.ok(html.includes('<details class="a33-checklist-block a33-checklist-history-disclosure">'), 'Histórico no usa un desplegable nativo');
assert.ok(html.includes('<summary>Histórico</summary>'), 'Falta el control visible del Histórico');
assert.ok(!html.includes('<details class="a33-checklist-block a33-checklist-history-disclosure" open>'), 'Histórico debe iniciar cerrado');
assert.ok(html.includes('const actionLabel = isHistory ? "Ver" : "Usar";'), 'El Histórico perdió la acción Ver');
assert.ok(html.includes('.a33-checklist-history-disclosure > summary:focus-visible'), 'El desplegable no conserva foco visible');

console.log('OK: Histórico está al final, cerrado por defecto y desplegable sin alterar la acción Ver.');
