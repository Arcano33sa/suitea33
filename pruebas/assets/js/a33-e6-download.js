/* Descarga inicial E1 para Inventario, Pedidos y Agenda. Solo lee Firestore. */
(function(g){
  'use strict';

  const MODULES = Object.freeze({
    inventario:{
      entities:['existencias','movimientos','recetas','calculadora_produccion'],
      keys:['arcano33_inventario','arcano33_recetas_v1']
    },
    pedidos:{
      entities:['pedidos','pedidos_rapidos','historico'],
      keys:['arcano33_pedidos','arcano33_pedidos_rapidos_v1','arcano33_pedidos_archived']
    },
    agenda:{ entities:['reuniones','tareas','compras'], keys:['a33_agenda_records_v1'] }
  });
  const running = new Map();

  function clone(value){
    if (value === undefined) throw new Error('Firestore contiene un valor E6 inválido.');
    return JSON.parse(JSON.stringify(value));
  }
  function payloads(documents){
    const rows=[];
    for (const doc of documents || []){
      const data=doc && typeof doc.data==='function' ? doc.data() : doc;
      const row=data && data.payload;
      if (!row || Array.isArray(row) || typeof row!=='object') throw new Error('Firestore contiene un registro E6 inválido.');
      rows.push(clone(row));
    }
    return rows;
  }
  function buildInventory(groups){
    const inv={liquids:{},bottles:{},finished:{},finishedByProductId:{},caps:{},varios:[],movimientos:[]};
    for (const row of groups.existencias || []){
      const section=String(row.section || '');
      if (section==='varios'){ inv.varios.push(clone(row.item)); continue; }
      if (!Object.prototype.hasOwnProperty.call(inv,section) || Array.isArray(inv[section])) throw new Error('Firestore contiene una sección de Inventario inválida.');
      const key=String(row.key || '').trim();
      if (!key || Object.prototype.hasOwnProperty.call(inv[section],key)) throw new Error('Firestore contiene una existencia sin clave o duplicada.');
      inv[section][key]=clone(row.item);
    }
    inv.movimientos=(groups.movimientos || []).map(clone);
    return inv;
  }
  function plan(moduleId, groups, has){
    const writes=[];
    if (moduleId==='inventario'){
      if (!has('arcano33_inventario') && ((groups.existencias || []).length || (groups.movimientos || []).length))
        writes.push(['arcano33_inventario',buildInventory(groups)]);
      const recipe=(groups.recetas || []).find(row=>row.storageKey==='arcano33_recetas_v1');
      if (!has('arcano33_recetas_v1') && recipe) writes.push(['arcano33_recetas_v1',clone(recipe.value)]);
      const production=(groups.calculadora_produccion || [])[0];
      if (production && production.values && typeof production.values==='object'){
        Object.keys(production.values).sort().forEach(key=>{ if (!has(key)) writes.push([key,clone(production.values[key])]); });
      }
    } else if (moduleId==='pedidos'){
      [['pedidos','arcano33_pedidos'],['pedidos_rapidos','arcano33_pedidos_rapidos_v1'],['historico','arcano33_pedidos_archived']]
        .forEach(([entity,key])=>{ if (!has(key) && (groups[entity] || []).length) writes.push([key,(groups[entity] || []).map(clone)]); });
    } else if (moduleId==='agenda'){
      const records=['reuniones','tareas','compras'].flatMap(entity=>(groups[entity] || []).map(clone));
      if (!has('a33_agenda_records_v1') && records.length) writes.push(['a33_agenda_records_v1',{schemaVersion:9,updatedAt:new Date().toISOString(),records}]);
    } else throw new Error('Módulo E6 no admitido.');
    return writes;
  }
  function setStatus(message, warn){
    const el=typeof document!=='undefined' ? document.getElementById('a33-e6-cloud-status') : null;
    if (!el) return;
    el.textContent=message;
    el.hidden=false;
    if (warn) el.setAttribute('data-kind','warn'); else el.removeAttribute('data-kind');
  }
  function commit(writes,authorized,storage){
    const prepared=writes.map(([key,value])=>[key,JSON.stringify(value)]);
    prepared.forEach(([key])=>{
      if (!authorized()) throw new Error('La sesión cambió durante la descarga.');
      if (storage.getItem(key)!==null) throw new Error('Se detectaron datos locales durante la descarga; se conservaron sin cambios.');
    });
    const completed=[];
    try{
      for (const [key,value] of prepared){
        if (!authorized()) throw new Error('La sesión cambió durante la descarga.');
        storage.setItem(key,value);
        completed.push([key,value]);
      }
    }catch(error){
      completed.forEach(([key,value])=>{ if (storage.getItem(key)===value) storage.removeItem(key); });
      throw error;
    }
  }
  async function execute(moduleId){
    const spec=MODULES[moduleId];
    if (!spec) throw new Error('Módulo E6 no admitido.');
    let expired=false;
    let timer;
    try{
      setStatus('Comprobando información en la nube…');
      if (spec.keys.every(key=>localStorage.getItem(key)!==null)){
        const result={written:0,preserved:spec.keys.length};
        setStatus('Se conservaron las fuentes locales existentes; no fue necesario descargar datos.');
        return result;
      }
      const gate=await Promise.race([
        g.A33ModuleGuard.evaluate(moduleId),
        new Promise((_,reject)=>{ timer=setTimeout(()=>reject(new Error('Tiempo de espera agotado al verificar la sesión.')),15000); })
      ]);
      clearTimeout(timer);
      if (!gate.allowed) throw new Error('Inicia sesión y vuelve a abrir este módulo.');
      const initial=g.A33Access.getState();
      const authorized=()=>{
        const current=g.A33Access.getState();
        return !expired && !!initial.user && current.user?.uid===initial.user.uid
          && current.workspaceId===initial.workspaceId
          && g.A33Access.evaluateModuleAccess(moduleId,current,{enforcementEnabled:true}).allowed;
      };
      const task=(async()=>{
        const app=await g.A33Firebase.initFirebaseApp(g.A33FirebaseSettings.read());
        const db=g.firebase.firestore(app);
        const groups={};
        await Promise.all(spec.entities.map(async entity=>{
          const snapshot=await db.collection('workspaces').doc(initial.workspaceId).collection('modules').doc(moduleId)
            .collection('entities').doc(entity).collection('records').get({source:'server'});
          groups[entity]=payloads(snapshot.docs);
        }));
        if (!authorized()) throw new Error('La sesión cambió durante la descarga.');
        const has=key=>localStorage.getItem(key)!==null;
        const writes=plan(moduleId,groups,has);
        commit(writes,authorized,localStorage);
        return {written:writes.length,preserved:spec.keys.filter(has).length};
      })();
      const result=await Promise.race([task,new Promise((_,reject)=>{
        timer=setTimeout(()=>{expired=true;reject(new Error('Tiempo de espera agotado.'));},20000);
      })]);
      setStatus(result.written
        ? `Carga inicial: ${result.written} fuente(s) local(es) reconstruida(s) desde Firebase.`
        : 'No se descargaron datos: se conservaron las fuentes locales existentes o no había registros remotos.');
      return result;
    }catch(error){
      setStatus('No se completó la descarga inicial. Se conservaron los datos locales. '+String(error.message || error),true);
      return {written:0,error:String(error.message || error)};
    }finally{ expired=true; clearTimeout(timer); }
  }
  function ready(moduleId){
    if (!running.has(moduleId)) running.set(moduleId,execute(moduleId));
    return running.get(moduleId);
  }
  g.A33E6Download=Object.freeze({ready,payloads,buildInventory,plan,commit,modules:MODULES});
})(typeof globalThis!=='undefined' ? globalThis : window);
