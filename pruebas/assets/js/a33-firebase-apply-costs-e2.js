/* Suite A33 — migración única de Costos multidispositivo (E2). */
(function(g){
  'use strict';
  const RESULT_KEY='suite_a33_firebase_apply_costs_e2_v1';
  const STORAGE_KEY='a33_catalogos_costos_v1';

  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function finite(value){ return value===null || (typeof value==='number' && Number.isFinite(value) && value>=0); }
  function normalize(raw){
    let value=raw;
    if (typeof value==='string'){ try{ value=JSON.parse(value); }catch(_){ throw new Error('La configuración de Costos del respaldo no contiene JSON válido.'); } }
    if (!value || typeof value!=='object' || Array.isArray(value) || value.schemaVersion!==2) throw new Error('La configuración de Costos del respaldo no usa el esquema esperado.');
    if (!value.liquids || typeof value.liquids!=='object' || Array.isArray(value.liquids)) throw new Error('Costos no contiene líquidos válidos.');
    if (!value.consumablesByProduct || typeof value.consumablesByProduct!=='object' || Array.isArray(value.consumablesByProduct)) throw new Error('Costos no contiene consumibles válidos.');
    Object.values(value.liquids).forEach(item=>{
      if (!item || typeof item!=='object' || Array.isArray(item) || !finite(item.price) || !finite(item.ml)) throw new Error('Costos contiene un líquido inválido.');
    });
    Object.values(value.consumablesByProduct).forEach(item=>{
      if (!item || typeof item!=='object' || Array.isArray(item) || !finite(item.botella) || !finite(item.calcomania)) throw new Error('Costos contiene un consumible inválido.');
    });
    if (typeof value.updatedAt!=='string' || !value.updatedAt.trim()) throw new Error('Costos no contiene fecha de actualización válida.');
    return clone(value);
  }
  function fromBackup(backup){
    const local=backup && backup.data && backup.data.localStorage;
    if (!local || !Object.prototype.hasOwnProperty.call(local,STORAGE_KEY)) throw new Error('La carga E4 no contiene configuración de Costos.');
    return normalize(local[STORAGE_KEY]);
  }
  function documentFor(value,context){
    const engine=g.A33FirestoreData;
    if (!engine || typeof engine.createDocument!=='function') throw new Error('No está disponible el contrato Firestore.');
    const document=engine.createDocument({workspaceId:context.workspaceId,moduleId:'catalogos',entityId:'costos',recordId:'actual',sourceId:STORAGE_KEY,updatedBy:context.uid,deviceId:context.deviceId,payload:{storageKey:STORAGE_KEY,value:normalize(value)}});
    const validation=engine.validateDocument(document);
    if (!validation.ok) throw new Error('Costos: '+validation.errors.join(', '));
    return document;
  }
  async function apply(){
    const settings=g.A33FirebaseSettings?.read?.();
    const auth=g.A33FirebaseAuth?.getState?.();
    const access=g.A33Access?.getState?.();
    if (!settings || !settings.enabled || !settings.configured) throw new Error('Firebase debe estar activado y configurado.');
    if (!auth?.authenticated || !auth.user?.uid || !access?.isAdmin || access.profile?.status!=='active') throw new Error('E2 requiere un perfil Admin activo.');
    const last=g.A33FirebaseImport?.readLast?.();
    if (!last) throw new Error('No existe una carga E4 preparada en este navegador.');
    const app=await g.A33Firebase.initFirebaseApp(settings);
    const db=g.firebase.firestore(app);
    if (!g.A33FirebaseApplyE5?.readStaged) throw new Error('No está disponible el lector seguro de E4.');
    const workspaceId=String(settings.workspaceId || access.workspaceId || 'arcano33');
    const staged=await g.A33FirebaseApplyE5.readStaged(db,workspaceId,last);
    const value=fromBackup(staged.backup);
    const document=documentFor(value,{workspaceId,uid:auth.user.uid,deviceId:String(settings.deviceId || 'device')});
    const ref=db.doc(document.path);
    let identical=false;
    await db.runTransaction(async transaction=>{
      const snapshot=await transaction.get(ref);
      if (snapshot.exists){
        const current=snapshot.data();
        if (JSON.stringify(current && current.payload)===JSON.stringify(document.payload)){ identical=true; return; }
        throw new Error('Ya existe una configuración remota de Costos diferente. No se sobrescribió.');
      }
      transaction.set(ref,document);
    });
    const result={stage:'E2-Costos',status:'completed',workspaceId,importId:staged.manifest.importId,sourceChecksum:staged.manifest.checksum,recordPath:document.path,identical,completedAt:new Date().toISOString(),completedBy:auth.user.uid};
    localStorage.setItem(RESULT_KEY,JSON.stringify(result));
    return result;
  }
  function readLast(){ try{ const raw=localStorage.getItem(RESULT_KEY); return raw?JSON.parse(raw):null; }catch(_){ return null; } }
  g.A33FirebaseApplyCostsE2=Object.freeze({storageKey:STORAGE_KEY,normalize,fromBackup,documentFor,apply,readLast});
})(typeof globalThis!=='undefined' ? globalThis : window);
