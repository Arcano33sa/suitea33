'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const notices=[];
const host={A33Notify:{show(msg,type,options){notices.push({msg,type});return 'test';},dismiss(){}}};
const ctx=vm.createContext({window:host,Date,Object,String});vm.runInContext(read('assets/js/a33-notify-bridge.js'),ctx);
for(const [text,kind,expected] of [
 ['Pedido pendiente guardado','success','success'],['Producto Error guardado','success','success'],
 ['No se pudo guardar','error','error'],['Guardando producto Error','process','process'],
 ['Sin cambios','pending','pending'],['Carga en curso…','info','process'],['Stock insuficiente',undefined,'error'],
 ['Día abierto',undefined,'success'],['No se pudo guardar','warn','error']
])assert.equal(host.A33Notice.resolve(text,kind),expected,text);
const pos=read('pos/app.js');vm.runInContext(pos.slice(pos.indexOf('function posNoticeType('),pos.indexOf('// --- Helpers POS:')),ctx);
ctx.showToast('Carga en curso…','info',1500);assert.equal(notices.at(-1).type,'process');
ctx.toast('Error al cerrar');assert.equal(notices.at(-1).type,'error');
ctx.posNotify('Completa fecha y cantidad');assert.equal(notices.at(-1).type,'pending');
function recipe(module,mode){
 const html=read(module+'/index.html');const a=html.indexOf('    function guardarRecetas()');const b=html.indexOf('    function cargarRecetas()',a);
 const states=[];
 const storage={sharedSet(){if(mode==='throw')throw Error('quota');if(mode==='reject')return {ok:false};return {ok:true};}};
 const c={window:{A33Storage:storage,A33Notice:{show:(msg,type)=>states.push(type)}},A33Storage:storage,console:{warn(){}},
  PRESENTACIONES:[{id:'test'}],INGREDIENTES:[],getNumberValue:()=>null,a33SerializePresentacionProducto:()=>({}),
  capturarPayloadRecetasDesdeUI:()=>({}),STORAGE_RECETAS_KEY:'test',writeTemporalData(){if(mode!=='success')throw Error('quota');}};
 vm.createContext(c);vm.runInContext(html.slice(a,b),c);c.guardarRecetas();
 assert.equal(states[0],'process');assert.equal(states.at(-1),mode==='success'?'success':'error');
 if(mode!=='success')assert(!states.includes('success'),module+' anuncia guardado tras fallo');
}
for(const mod of ['calculadora','calculadora_temporal'])for(const mode of ['success','throw','reject'])recipe(mod,mode);
for(const [mod,name,end] of [
 ['calculadora','a33SetChecklistStatus','a33ChecklistIngredients'],
 ['calculadora_temporal','a33SetTemporalChecklistStatus','a33WriteTemporalChecklistRecord']
]){
 const html=read(mod+'/index.html'),a=html.indexOf('    function '+name),b=html.indexOf('    function '+end,a);
 const states=[],el={dataset:{},removeAttribute(){}};
 const c={window:{A33Notice:{show:(msg,type)=>states.push(type)}},document:{getElementById:()=>el},String};
 vm.createContext(c);vm.runInContext(html.slice(a,b),c);
 c[name]('Guardando…','saving');c[name]('Guardado','success');c[name]('No se pudo guardar','error');
 assert.deepEqual(states,['process','success','error']);
 c[name]('Solo consulta','');assert.equal(states.length,3,'Un texto de consulta creó un aviso de operación');
}
console.log('PASS E3: estados explícitos, POS común, recetas con éxito/fallo/rechazo y avisos de checklist');
