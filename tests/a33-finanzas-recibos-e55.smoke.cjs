'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../finanzas/script.js'),'utf8');
const block=source.slice(source.indexOf('// E5.5: el formulario'),source.indexOf('function rcNextConsecutive4'));
let rows=[],abortAfterPut=false,queue=Promise.resolve();
const db={transaction(){
 const tx={error:null,objectStore(){return{getAll(){const req={};queue=queue.then(()=>new Promise(done=>{
  tx.done=done;tx.original=structuredClone(rows);setImmediate(()=>{req.result=structuredClone(rows);req.onsuccess();});
 }));return req;},put(row){const req={};const index=rows.findIndex(r=>r.receiptId===row.receiptId);if(index<0)rows.push(structuredClone(row));else rows[index]=structuredClone(row);
 setImmediate(()=>{if(abortAfterPut){tx.error=Error('abort tardío');tx.abort();}else{tx.oncomplete();tx.done();}});return req;}};},abort(){rows=tx.original;setImmediate(()=>{tx.onabort();tx.done();});}};return tx;
}};
const c=vm.createContext({console,JSON,Map,Array,String,Number,Date,finDB:db,document:{getElementById:()=>null}});vm.runInContext(block,c);
(async()=>{
 const first={receiptId:'a',status:'DRAFT',number:null,lines:[],legacy:{x:1}};rows=[structuredClone(first),{receiptId:'void',status:'VOID',number:'0040'}];
 const saved=await c.rcCommitReceipt({...first,clientName:'nuevo'},first,'save');assert.equal(saved.legacy.x,1);
 await assert.rejects(c.rcCommitReceipt({...first,clientName:'atrasado'},first,'save'),/cambió/);
 const issued=await c.rcCommitReceipt({...saved,status:'ISSUED'},saved,'issue');assert.equal(issued.number,'0041');
 await assert.rejects(c.rcCommitReceipt(saved,saved,'save'),/cambió/);
 await assert.rejects(c.rcCommitReceipt({...issued,status:'DRAFT'},issued,'save'),/estado/);
 await assert.rejects(c.rcCommitReceipt({...first,receiptId:'a'},null,'save'),/cambió/);
 await assert.rejects(c.rcCommitReceipt(first,undefined,'save'),/versión original/);
 const deleted={receiptId:'gone',status:'DRAFT'};await assert.rejects(c.rcCommitReceipt(deleted,deleted,'save'),/cambió/);
 const [one,two]=await Promise.all(['b','c'].map(receiptId=>c.rcCommitReceipt({receiptId,status:'ISSUED'},null,'issue')));assert.deepEqual([one.number,two.number],['0042','0043']);
 const legacy={receiptId:3,status:'DRAFT',unknown:'preservar'};rows.push(legacy);
 const updated=await c.rcCommitReceipt({receiptId:'3',status:'DRAFT',clientName:'histórico'},legacy,'save');assert.equal(updated.receiptId,3);assert.equal(updated.unknown,'preservar');
 const before=structuredClone(rows);abortAfterPut=true;await assert.rejects(c.rcCommitReceipt({receiptId:'failed',status:'ISSUED'},null,'issue'),/abort/);assert.deepEqual(rows,before);abortAfterPut=false;
 const voided=await c.rcCommitReceipt({...issued,status:'VOID',voidReason:'prueba'},issued,'void');assert.equal(voided.number,'0041');await assert.rejects(c.rcCommitReceipt({...issued,status:'VOID'},issued,'void'),/cambió/);
 const sameTime={receiptId:'same-time',status:'DRAFT',updatedAt:'fixed',clientName:'uno'};rows.push({...sameTime,clientName:'dos'});
 await assert.rejects(c.rcCommitReceipt(sameTime,sameTime,'save'),/cambió/);
 rows.push({receiptId:9,status:'DRAFT'},{receiptId:'9',status:'DRAFT'});await assert.rejects(c.rcCommitReceipt({receiptId:'9',status:'DRAFT'},{receiptId:9,status:'DRAFT'},'save'),/cambió/);
 Object.assign(c,{rcSaving:false,rcCurrent:{receiptId:'attempt',status:'DRAFT',number:null,dateISO:'2026-10-01'},rcEditorMode:'edit',rcEditBase:null,
   rcValidateCurrent:()=>({ok:true}),confirm:()=>true,rcSetSaving:()=>{},rcTodayISO:()=> '2026-10-03',rcLongDateDisplay:()=> 'fecha',rcPersistPending:()=>true,rcShowAlert:()=>{},rcCommitReceipt:async()=>{throw Error('fallo simulado');}});
 vm.runInContext(source.slice(source.indexOf('async function rcIssueCurrent(){'),source.indexOf('async function rcVoidReceiptById')),c);
 assert.equal(await c.rcIssueCurrent(),false);assert.equal(c.rcCurrent.status,'DRAFT');assert.equal(c.rcCurrent.number,null);assert.equal(c.rcCurrent.dateISO,'2026-10-01');
 console.log('PASS E5.5: transacción completa, aborto tardío, CAS, emisión concurrente, estados, claves históricas, metadata y anulación');
})().catch(e=>{console.error(e);process.exitCode=1;});
