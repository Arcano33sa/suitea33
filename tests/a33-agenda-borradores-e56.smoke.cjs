'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../agenda/script.js'),'utf8');
const block=source.slice(0,source.indexOf('})();')+5);
const storage=new Map();let failSet=false,failRead=false,accept=false,restoreCount=0,serial=0,ready=true,busy=false,race=false;
class Element{constructor(){this.dataset={};this.value='';this.hidden=true;this.children=[];this.listeners={};this.textContent='';}addEventListener(e,fn){this.listeners[e]=fn;}appendChild(el){this.children.push(el);}set innerHTML(v){this.children=[];}querySelector(selector){return this.parts[selector];}}
const fields={title:new Element(),qty:new Element()},panels={};
function panel(){const el=new Element();el.parts=Object.fromEntries(['list','status','warning','refresh'].map(k=>['[data-pending-'+k+']',new Element()]));return el;}
panels.main=panel();panels.other=panel();
const window={localStorage:{get length(){return storage.size;},key:i=>Array.from(storage.keys())[i],getItem:k=>{if(failRead)throw Error('lectura bloqueada');return storage.get(k)||null;},setItem:(k,v)=>{if(failSet)throw Error('quota');storage.set(k,v);},removeItem:k=>storage.delete(k)},addEventListener(){},confirm:()=>accept};
const c=vm.createContext({window,document:{getElementById:id=>fields[id]||panels[id],createElement:()=>new Element(),addEventListener(){}},console,Date,JSON,Set,Number,String,Array,Object});vm.runInContext(block,c);
function make(panelId,prefix){return window.A33AgendaPending.create({kind:'form',prefix,panel:panelId,form:new Element(),fields:['title','qty'],types:['reunion','tarea'],makeId:()=> 'id-'+(++serial),snapshot:()=>({safe:true}),valid:d=>!!d&&d.safe===true,label:r=>r.fields.title,busy:()=>busy,ready:()=>ready,restore:async r=>{restoreCount++;fields.title.value=r.fields.title;fields.qty.value=r.fields.qty;if(race)storage.set('a33_agenda_records_v1',JSON.stringify([{...r.meta.base,subject:'cambio durante carga'}]));}});}
const pending=make('main','a33_agenda_form_draft_v1_');
(async()=>{
 pending.begin('reunion');assert.equal(pending.persist(),true);assert.equal(storage.size,0,'Abrir sin editar no crea copia');
 fields.title.value='Pendiente';fields.qty.value='';assert.equal(pending.persist(true),true);
 const key=Array.from(storage.keys())[0],original=storage.get(key),record=JSON.parse(original);assert.equal(pending.valid(record),true);assert.equal(record.fields.qty,'');
 for(const bad of [{...record,schemaVersion:2},{...record,kind:'purchase'},{...record,meta:{...record.meta,type:'compra'}},{...record,fields:{title:'incompleto'}},{...record,data:null}])assert.equal(pending.valid(bad),false);
 failSet=true;fields.title.value='Solo memoria';assert.equal(pending.persist(true),false);assert.equal(storage.get(key),original);assert.equal(panels.main.parts['[data-pending-warning]'].hidden,false);
 assert.equal(pending.leave(),false,'Rechazar la pérdida mantiene activo el formulario');failSet=false;assert.equal(pending.leave(),true);
 // Guardar la copia conservadora anterior como fuente permite recuperar sin tocar registros.
 storage.set(key,original);const baseline=storage.get('a33_agenda_records_v1');await pending.recover(key);assert.equal(restoreCount,1);assert.equal(fields.title.value,'Pendiente');assert.equal(storage.get('a33_agenda_records_v1'),baseline);assert.equal(storage.get(key),original);assert.equal(storage.size,2);assert.equal(pending.id,record.meta.id);
 const other=make('other','a33_agenda_form_draft_v1_');other.begin('tarea');other.persist(true);assert.equal(storage.size,3,'Dos formularios tienen claves independientes');other.leave();
 storage.set('a33_agenda_records_v1',JSON.stringify({records:[{id:record.meta.id,type:'reunion'}]}));assert.equal(pending.beforeSave(),false);await pending.recover(key);assert.equal(restoreCount,1,'No recuperar un intento registrado');
 const legacy={id:'legacy',type:'tarea',subject:'vieja'};storage.set('a33_agenda_records_v1',JSON.stringify([legacy]));pending.begin('tarea','legacy');pending.persist(true);
 const editKey=Array.from(storage.keys()).find(k=>k.startsWith('a33_')&&JSON.parse(storage.get(k)).meta?.id==='legacy');pending.leave();await pending.recover(editKey);assert.equal(restoreCount,2);assert.equal(pending.beforeSave(),true,'Compatibilidad con lista histórica sin timestamps');
 storage.set('a33_agenda_records_v1',JSON.stringify([{...legacy,subject:'otra'}]));assert.equal(pending.beforeSave(),false);await pending.recover(editKey);assert.equal(restoreCount,2);
 storage.set('a33_agenda_records_v1',JSON.stringify([]));await pending.recover(editKey);assert.equal(restoreCount,2,'Registro ausente no se recrea');
 failRead=true;assert.equal(pending.beforeSave(),false);failRead=false;
 storage.set('a33_agenda_records_v1',JSON.stringify([]));ready=false;await pending.recover(key);assert.equal(restoreCount,2);ready=true;busy=true;await pending.recover(key);assert.equal(restoreCount,2);busy=false;
 pending.begin('tarea');pending.persist(true);const total=storage.size;pending.confirmed();assert.equal(storage.size,total-1,'Solo se quita la copia de trabajo confirmada');assert.equal(storage.get(key),original);
 storage.set('a33_agenda_records_v1',JSON.stringify([legacy]));race=true;await pending.recover(editKey);assert.equal(pending.beforeSave(),false);fields.title.value='Trabajo tras conflicto';assert.equal(pending.persist(true),true);assert.match(panels.main.parts['[data-pending-warning]'].textContent,/cambió/);race=false;storage.set('a33_agenda_records_v1',JSON.stringify([legacy]));await pending.recover(editKey);assert.equal(pending.beforeSave(),true,'Una recuperación válida posterior permite continuar');pending.render();
 storage.set('a33_agenda_records_v1',JSON.stringify([{...legacy,subject:'versión más nueva'}]));
 const knownKeys=new Set(storage.keys());pending.begin('tarea','legacy',legacy);pending.persist(true);
 const explicitBaseKey=Array.from(storage.keys()).find(k=>!knownKeys.has(k));assert(explicitBaseKey);assert.equal(JSON.parse(storage.get(explicitBaseKey)).meta.base.subject,'vieja');
 assert.equal(pending.beforeSave(),false,'E5.8 protege también las ediciones normales sobre la versión mostrada');pending.leave();const beforeRestore=restoreCount;await pending.recover(explicitBaseKey);assert.equal(restoreCount,beforeRestore,'La copia conserva la versión mostrada y rechaza la más nueva');pending.render();
 const discardRow=panels.main.parts['[data-pending-list]'].children.find(el=>el.dataset.pendingKey===key);assert(discardRow);accept=true;const domain=storage.get('a33_agenda_records_v1');discardRow.children[2].onclick();assert.equal(storage.has(key),false);assert.equal(storage.get('a33_agenda_records_v1'),domain,'Descartar solo quita la copia elegida');
 console.log('PASS E5.6: estructura, campos crudos, recuperación explícita, fuentes intactas, identidad, copias independientes, fallo conservador, registro cambiado/ausente/guardado, lectura fallida y carga bloqueada');
})().catch(e=>{console.error(e);process.exitCode=1;});
