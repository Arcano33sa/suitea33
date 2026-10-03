// Coherencia de versiones y precache: a33-publicacion-coherencia.smoke.cjs.
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const app = read('pos/app.js');
class Node {
  constructor(){this.children=[];this.attrs={};this.dataset={};this.classList={add(){},remove(){}};}
  appendChild(n){n.parent=this;this.children.push(n);}
  remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];}
}
const body=new Node(), timers=new Map();let sequence=0;
const context={document:{body,createElement:()=>new Node(),getElementById:id=>body.children.find(n=>n.id===id)},setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),console};
context.window=context;vm.createContext(context);
vm.runInContext(read('assets/js/a33-notify.js'),context);
vm.runInContext(read('assets/js/a33-notify-bridge.js'),context);
const adapter=app.slice(app.indexOf('function posNoticeType('),app.indexOf('// --- Helpers POS:'));
vm.runInContext(adapter,context);
const region=()=>body.children[0];
for(const [type,ms] of [['process',5000],['success',5000],['pending',5000],['error',7000]]){
 const id=context.A33Notify.show('<b>Texto seguro</b>',type);
 const node=region().children.at(-1);
 assert.equal(node.className,'a33-notice is-'+type);
 assert.equal(node.children[1].children[1].textContent,'<b>Texto seguro</b>');
 assert.equal(node.attrs.role,type==='error'?'alert':'status');
 const timer=[...timers.values()].at(-1);assert.equal(timer.ms,ms);
 timer.fn();assert(!region().children.includes(node));context.A33Notify.dismiss(id);
}
context.showToast('Guardando…','process',15000);
context.showToast('Venta agregada','ok',1800);
assert.equal(region().children.length,1);assert.equal(region().children[0].className,'a33-notice is-success');
context.showToast('Error al guardar');
assert.equal(region().children.at(-1).className,'a33-notice is-error');
assert.equal(region().children.length,2,'El éxito no debe ocultar un error de otro efecto');
context.posNotify('Completa fecha, producto y cantidad');assert.equal(region().children.at(-1).className,'a33-notice is-pending');
context.toast('Evento eliminado; hay reversos pendientes.');assert.equal(region().children.at(-1).className,'a33-notice is-pending');
context.posNotify('Grupo ocultado.');assert.equal(region().children.at(-1).className,'a33-notice is-success');
const lock=app.slice(app.indexOf('const __A33_SAVE_LOCKS_POS'),app.indexOf('function isValidYmdStrictPOS'));
vm.runInContext(lock,context);
(async()=>{
 let called=false;
 await context.runWithSavingLockPOS({key:'venta',fn:async()=>{called=true;assert(region().children.some(n=>n.className==='a33-notice is-process'));context.toast('Venta agregada');}});
 assert(called);assert(!region().children.some(n=>n.className==='a33-notice is-process'));
 let errorSeen=false;
 await context.runWithSavingLockPOS({key:'venta',fn:async()=>{throw Error('Fallo');},onError:()=>{errorSeen=true;context.showToast('No se pudo guardar','error');}});
 assert(errorSeen);assert(!region().children.some(n=>n.className==='a33-notice is-process'));
 const html=read('pos/index.html'),sw=read('pos/sw.js');
 for(const asset of ['assets/js/a33-notify.js','assets/css/a33-notify.css','app.js']){assert(html.includes(asset));assert(sw.includes(asset));}
 assert(html.indexOf('a33-notify.js')<html.indexOf('src="app.js'));
 assert(!/(?<![\w.])(?:window\.)?alert\(/.test(app));assert(app.includes('confirm('));assert(app.includes('prompt('));
 console.log('PASS: estados, tiempos, texto seguro, sustitución, ventas, errores y precaché POS');
})().catch(e=>{console.error(e);process.exitCode=1;});
