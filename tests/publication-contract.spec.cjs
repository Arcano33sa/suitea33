'use strict';
const assert = require('node:assert/strict');
const {read,inspectModule,releaseData} = require('./publication-contract.cjs');
const html=read('pos/index.html'),sw=read('pos/sw.js');
const nextAsset='app.js?v='+releaseData().suiteVersion+'&r=99999';
inspectModule('pos');
assert.throws(()=>inspectModule('pos',{html:html.replace(/app\.js\?v=([^"']+)/,'app.js?v=0.0.0&r=1')}),/incompatible/);
assert.throws(()=>inspectModule('pos',{sw:sw.replace(/\.\/app\.js\?v=([^']+)/,'./'+nextAsset)}),/desalineados/);
assert.throws(()=>inspectModule('pos',{exists:url=>!url.pathname.endsWith('/app.js')}),/inexistente/);
assert.throws(()=>inspectModule('pos',{manifest:{start_url:'../pedidos/index.html'}}),/no inicia/);
assert.throws(()=>inspectModule('pos',{sw:sw.replace(/MODULE_CACHE_REV = '\d+'/,"MODULE_CACHE_REV = 'inválida'")}),/caché incompatible/);
// Una revisión propia coherente puede aumentar sin reescribir la prueba.
inspectModule('pos',{html:html.replace(/app\.js\?v=([^"']+)/,nextAsset),sw:sw.replace(/\.\/app\.js\?v=([^']+)/,'./'+nextAsset)});
console.log('PASS: detecta versiones incompatibles, precache desalineado, recursos ausentes, inicio incorrecto y caché inválida; permite revisiones coherentes.');
