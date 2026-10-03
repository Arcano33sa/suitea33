'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {modules,read,releaseData,inspectModule} = require('./publication-contract.cjs');
const release = releaseData();
const context = vm.createContext({window:{A33_RELEASE:release}});
vm.runInContext(read('assets/js/a33-build.js'),context);
assert.equal(context.window.A33_VERSION,release.suiteVersion);
assert.equal(context.window.A33_ASSET_REV,String(release.rev));
const fallback=vm.createContext({window:{}});vm.runInContext(read('assets/js/a33-build.js'),fallback);
assert.equal(fallback.window.A33_VERSION,release.suiteVersion,'Fallback de build incompatible');
assert.equal(fallback.window.A33_ASSET_REV,String(release.rev),'Fallback de revisión incompatible');
const label=read('assets/js/a33-release.js').match(/const lastResort = '([^']+)'/);assert(label);assert.equal(label[1],release.label,'Fallback visual incompatible');
for (const module of modules) {
  const report = inspectModule(module);
  assert.equal(context.window.A33_CACHE_NAME(module.replace('_','-')),report.cacheId,'Build/worker desalineados: '+module);
  console.log('PASS coherencia: '+module);
}
for (const module of ['configuracion','finanzas','analitica']) {
  const html=read(module+'/index.html');
  assert(/a33-storage\.js\?v=/.test(html),module+': storage compartido ausente');
  assert(html.includes('v='+release.suiteVersion),module+': versión global ausente');
  const storage=html.replaceAll('&amp;','&').match(/a33-storage\.js\?([^"']+)/)[1];
  const expected=read('pos/index.html').match(/a33-storage\.js\?([^"']+)/)[1];
  assert.equal(storage,expected,module+': almacenamiento compartido desalineado');
}
console.log('PASS: coherencia de publicación independiente de pruebas funcionales; sin exigir una revisión histórica exacta.');
