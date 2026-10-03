'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {precache, releaseData} = require('./publication-contract.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const release = releaseData();
const build = vm.createContext({window:{A33_RELEASE:release}});
vm.runInContext(read('assets/js/a33-build.js'), build);
async function harness(module, active, failure=false) {
  const listeners = {}, writes = [], matches = []; let skipped=0, claimed=0;
  const base = 'https://suite.test/' + module + '/';
  const context = vm.createContext({URL, Set, Response, importScripts(){},
    self:{A33_RELEASE:release,location:{origin:'https://suite.test'},registration:{scope:base,active:active?{}:null},clients:{async claim(){claimed++;}},async skipWaiting(){skipped++;},addEventListener(type,handler){listeners[type]=handler;}},
    caches:{async open(name){assert.strictEqual(name,build.window.A33_CACHE_NAME(module));return {
      async addAll(){if(failure)throw new Error('recurso fallido');},
      async put(url){writes.push(url);},
      async match(url){matches.push(url);return new Response('archivo del módulo');}
    };}},
    async fetch(){throw new Error('sin red');}
  });
  vm.runInContext(read(module + '/sw.js'),context);
  let task;listeners.install({waitUntil(p){task=p;}});
  if(failure){await assert.rejects(task,/recurso fallido/);assert.strictEqual(skipped,0);return;}
  await task;assert.strictEqual(skipped,active?0:1);
  listeners.activate({waitUntil(p){task=p;}});await task;assert.strictEqual(claimed,1);
  listeners.message({data:{type:'SKIP_WAITING'},waitUntil(p){task=p;}});await task;assert.strictEqual(skipped,active?1:2);
  function fetchEvent(url, mode='cors', method='GET') {
    let result; listeners.fetch({request:{url,mode,method},respondWith(p){result=p;}});return result;
  }
  assert.strictEqual(fetchEvent('https://suite.test/pos/index.html','navigate'),undefined);
  assert.strictEqual(fetchEvent('https://otro.test/archivo.js'),undefined);
  assert.strictEqual(fetchEvent(base+'script.js','cors','POST'),undefined);
  assert.strictEqual(fetchEvent(base+'ruta-desconocida','navigate'),undefined);
  const response=await fetchEvent(base+'index.html?prueba=1','navigate');
  assert.strictEqual(await response.text(),'archivo del módulo');
  assert.strictEqual(matches.at(-1),base+'index.html');
  assert.strictEqual(writes.length,0);
  assert.ok(fetchEvent('https://suite.test/pos/vendor/xlsx.full.min.js?v=4.20.98&r=13'));
}
(async()=>{
  for(const module of ['finanzas','analitica']) {
    const base=new URL('https://suite.test/'+module+'/');
    const html=read(module+'/index.html');const source=read(module+'/sw.js');
    const urls=precache(source).map(url=>new URL(url,base));
    for(const url of urls)assert.ok(fs.existsSync(path.join(root,url.pathname)),'Precache inexistente: '+url.pathname);
    for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const value=match[1].replaceAll('&amp;','&');
      if(/^https?:/.test(value)||! /\.(js|css|png)(\?|$)/.test(value))continue;
      const url=new URL(value,base);assert.ok(urls.some(entry=>entry.href===url.href),'HTML/precache desalineados: '+url.href);
    }
    assert.match(html,/serviceWorker\.register\('\.\/sw\.js\?v=/);
    await harness(module,false);await harness(module,true);await harness(module,true,true);
  }
  console.log('APROBADA E4.3: precache y build coherentes, primera activación, actualizaciones controladas, instalación fallida y aislamiento.');
})().catch(error=>{console.error(error);process.exitCode=1;});
