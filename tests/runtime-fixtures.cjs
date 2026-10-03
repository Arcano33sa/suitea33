
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Dependencias reales de funciones aisladas; no sustituye la lógica bajo prueba.
function calculatorDependencies(html) {
  return ['a33NormalizeLetter','a33SortPresentaciones','a33IsStandaloneProduction'].map(name => {
    const start = html.indexOf('    function ' + name + '(');
    const end = html.indexOf('\n    function ', start + 1);
    assert(start >= 0 && end > start, 'Dependencia real ausente: ' + name);
    return html.slice(start, end);
  }).join('\n');
}
function installNotice(windowObj) {
  const calls = [];
  windowObj.A33Notify = { show(message, type) { calls.push({message:String(message), type}); return 'fixture-' + calls.length; }, dismiss() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/a33-notify-bridge.js'), 'utf8'), {window:windowObj, console});
  return calls;
}
module.exports = {calculatorDependencies, installNotice};
