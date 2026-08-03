'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

(async()=>{
  const root = path.resolve(__dirname, '..');
  const swPath = path.join(root, 'pos/sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');

  const urlsMatch = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(urlsMatch, 'No se encontró PRECACHE_URLS');
  const urls = Array.from(urlsMatch[1].matchAll(/'([^']+)'/g), match => match[1]);
  assert.ok(urls.length >= 10, 'Precache POS incompleto');

  for (const url of urls){
    const clean = url.split('?')[0];
    let target;
    if (clean === './') target = path.join(root, 'pos');
    else if (clean.startsWith('./')) target = path.join(root, 'pos', clean.slice(2));
    else if (clean.startsWith('/assets/')) target = path.join(root, clean.slice(1));
    else continue;
    assert.ok(fs.existsSync(target), `Asset PWA inexistente: ${url}`);
  }

  const start = sw.indexOf('async function handleNavigate(request)');
  const end = sw.indexOf('async function handleAsset(request)', start);
  assert.ok(start >= 0 && end > start, 'No se pudo aislar handleNavigate');
  const source = sw.slice(start, end);
  const cachedIndex = { kind:'cached-index' };
  const sandbox = {
    CACHE_NAME:'a33-v4.20.97-pos-r5-m49',
    fetch:async()=>{ throw new Error('offline'); },
    caches:{
      open:async()=>({
        match:async key => String(key) === './index.html?v=4.20.97&r=32' ? cachedIndex : null,
        put:async()=>true
      })
    },
    Response:class Response {
      constructor(body, init){ this.body=body; this.status=init && init.status; this.headers=init && init.headers; }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.handleNavigate = handleNavigate;`, sandbox);
  const result = await sandbox.handleNavigate({url:'https://suitea33.test/pos/inventario'});
  assert.strictEqual(result, cachedIndex, 'La navegación offline no recupera el índice precacheado');

  assert.ok(sw.includes("const MODULE_CACHE_REV = '49';"), 'Cache rev POS incorrecto');
  assert.ok(sw.includes("cache.match('./offline.html')"), 'Falta fallback offline.html');
  assert.ok(sw.includes("cache.match('./index.html?v=4.20.97&r=32')"), 'Falta fallback al índice vigente');
  assert.ok(sw.includes('event.request.mode === \'navigate\''), 'Las navegaciones no pasan por handleNavigate');

  console.log('SMOKE OK — POS Inventario — Lotes cargados Etapa 3 — PWA y fallback offline');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
