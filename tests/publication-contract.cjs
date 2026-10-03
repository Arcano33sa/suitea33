'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const modules = ['pos','inventario','lotes','pedidos','catalogos','calculadora','agenda','centro-mando','calculadora_temporal'];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function precache(source) {
  const match = source.match(/const PRECACHE(?:_URLS)?\s*=\s*\[([\s\S]*?)\];/);
  assert(match, 'Lista de precache ausente');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
}
function releaseData(source = read('assets/js/a33-release.js')) {
  const context = vm.createContext({}); vm.runInContext(source, context); return context.A33_RELEASE;
}
function inspectModule(module, overrides = {}) {
  const html = overrides.html ?? read(module+'/index.html');
  const sw = overrides.sw ?? read(module+'/sw.js');
  const manifest = overrides.manifest ?? JSON.parse(read(module+'/manifest.webmanifest'));
  const release = overrides.release ?? releaseData();
  const exists = overrides.exists ?? (url => fs.existsSync(path.join(root, url.pathname)));
  const base = new URL('https://suite.test/'+module+'/');
  const entries = precache(sw).map(url => new URL(url,base));
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m => m[1].replaceAll('&amp;','&')).filter(url => !/^https?:/.test(url) && /\.(js|css|webmanifest)(\?|$)/.test(url)).map(url => new URL(url,base));
  for (const asset of assets) {
    assert(exists(asset), 'Recurso inexistente: '+asset.pathname);
    assert.equal(asset.searchParams.get('v'), release.suiteVersion, 'Versión de recurso incompatible: '+asset.pathname);
    assert(/^\d+$/.test(asset.searchParams.get('r') || ''), 'Revisión de recurso inválida: '+asset.pathname);
    assert(entries.some(url => url.href === asset.href), 'HTML/precache desalineados: '+asset.href);
  }
  for (const url of entries) assert(exists(url), 'Precache inexistente: '+url.pathname);
  if (['pos','inventario','lotes','pedidos','catalogos','agenda','centro-mando'].includes(module)) assert(entries.some(url => url.pathname === base.pathname+'offline.html'),'Fallback offline ausente del precache');
  for (const icon of manifest.icons || []) assert(exists(new URL(icon.src,base)),'Icono PWA inexistente');
  const registrationSource = html + ['script.js','app.js','purchases.js'].filter(file => fs.existsSync(path.join(root,module,file))).map(file => read(module+'/'+file)).join('\n');
  assert(/serviceWorker[\s\S]{0,100}\.register\s*\(/.test(registrationSource),'Registro PWA ausente');
  for (const match of registrationSource.matchAll(/['"](\.\/sw\.js\?v=\d[^'"]+)['"]/g)) {
    const url=new URL(match[1],base);
    assert.equal(url.searchParams.get('v'),release.suiteVersion,'Registro PWA usa versión incompatible');
    assert(/^\d+$/.test(url.searchParams.get('r') || ''),'Revisión de registro inválida');
  }
  const start = new URL(manifest.start_url,base);
  assert.equal(start.origin,base.origin,'Manifest cambia de origen');
  assert.equal(start.pathname,base.pathname+'index.html','Manifest no inicia en el módulo');
  if (start.searchParams.has('v')) assert.equal(start.searchParams.get('v'),release.suiteVersion,'Versión de inicio incompatible');
  assert(exists(start),'Inicio PWA inexistente');
  const context = vm.createContext({self:{A33_RELEASE:release,addEventListener(){}},importScripts(){}});
  vm.runInContext(sw+'\n;globalThis.cacheId=typeof CACHE_NAME!=="undefined"?CACHE_NAME:CACHE;',context);
  const cacheId = context.cacheId;
  const name = module.replace('_','-');
  assert(new RegExp('^a33-v'+release.suiteVersion.replaceAll('.','\\.')+'-'+name+'-r'+release.rev+'-m[0-9]+$').test(cacheId),'Identidad de caché incompatible');
  return {assets,entries,cacheId};
}
module.exports = {root,modules,read,precache,releaseData,inspectModule};
