'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');

function between(source, startToken, endToken){
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `No se encontró ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `No se encontró cierre para ${startToken}`);
  return source.slice(start, end);
}

(async()=>{
  const unified = between(app, 'async function buildEventClosureSheetsPOS(eventId, options={})', 'async function getOpenCashDaysForEventPOS(eventId)');
  for (const sheet of [
    'Resumen_Evento','Caja_Resumen','Caja_Movimientos','Caja_Conteo','Caja_Auditoria',
    'Inventario_Resumen','Inventario_Movimientos','Ventas_Detalle','Reempaque'
  ]) assert.ok(app.includes(sheet), `Falta la hoja ${sheet}`);
  assert.ok(unified.includes('cierre_evento_${safeName}.xlsx'), 'El generador no usa el nombre unificado de cierre');
  assert.ok(unified.includes('return exportEventClosureWorkbookPOS(eventId, options);'), 'Corte no reutiliza el generador unificado');
  assert.ok(unified.includes('return await exportEventClosureWorkbookPOS(eventId);'), 'Reexportación no reutiliza el generador unificado');

  const closeBlock = between(app, 'async function closeEvent(eventId)', 'async function reopenEvent(eventId)');
  assert.ok(closeBlock.includes('await generateCorteCSV(eventId, { closedAtIso })'), 'El cierre no pasa la fecha oficial al Excel');
  assert.ok(closeBlock.includes('Object.assign({}, ev, { closedAt: closedAtIso })'), 'Persistencia no reutiliza la fecha enviada al Excel');
  assert.ok(closeBlock.includes('await reempaqueRollbackFinalMermaForEventPOS(finalMerma)'), 'Fallo de Excel no revierte merma provisional');
  assert.ok(closeBlock.includes('El evento permanece abierto.'), 'Fallo de Excel no informa el bloqueo');
  assert.ok(!closeBlock.includes('¿Cerrar el evento de todas formas?'), 'Todavía existe escape para cerrar sin Excel');

  let rollbackCalls = 0;
  let eventWrites = 0;
  const closeSandbox = {
    async getAll(store){ return store === 'events' ? [{id:10,name:'Evento'}] : []; },
    async getOpenCashDaysForEventPOS(){ return []; },
    async showConfirmClosePOS(){ return true; },
    async reempaqueFinalizeMermaForEventPOS(){ return {eventId:10,ids:[1],provisional:true}; },
    async generateCorteCSV(){ throw new Error('fallo XLSX'); },
    async reempaqueRollbackFinalMermaForEventPOS(){ rollbackCalls += 1; },
    async put(){ eventWrites += 1; },
    humanizeError:error=>error.message,
    posNotify(){}, console:{error(){},warn(){},log(){}}, Date, Object, Error, String, Array
  };
  vm.createContext(closeSandbox);
  vm.runInContext(`${closeBlock}\nthis.closeEvent=closeEvent;`, closeSandbox);
  await closeSandbox.closeEvent(10);
  assert.strictEqual(rollbackCalls, 1, 'Fallo de Excel no revierte la merma provisional');
  assert.strictEqual(eventWrites, 0, 'El evento se guardó como cerrado aunque falló el Excel');

  const cashBlock = between(app, 'async function buildEventCashExportSheetsPOS(eventId)', 'function eventInventoryProductForRefPOS(products, ref)');
  let cashRows = [];
  let historyDays = [];
  let versionsByDay = {};
  const snapshots = new Map();
  const officialCalls = [];
  const cashSandbox = {
    CASH_V2_STORE:'cashV2',
    async getAll(){ return cashRows; },
    cashV2NormStatus:value=>String(value || 'OPEN').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN',
    safeYMD:value=>String(value || '').slice(0,10),
    cashV2DeriveCloseTs:row=>Number(row && row.closeTs) || 0,
    async listHistDaysForEvent(){ return historyDays; },
    async listSnapshots(_eid, dayKey){ return versionsByDay[dayKey] || []; },
    async loadSnapshot(_eid, dayKey, version){ return snapshots.get(`${dayKey}|${version}`) || null; },
    cashV2EventExportSnapshotFromRecordPOS:row=>({source:'CLOSED_RECORD_FALLBACK',ts:row.closeTs,data:{meta:{audit:[]}}}),
    cashV2HistExcelBuildSheetsFromSnapshots(tuples){
      officialCalls.push(tuples.map(item=>({dayKey:item.dayKey,v:item.v})));
      return {sheets:[
        {name:'Resumen',rows:[['resumen'],...tuples.map(item=>[item.dayKey,item.v])]},
        {name:'Movimientos',rows:[['movimientos']]},
        {name:'Conteo',rows:[['conteo']]}
      ]};
    },
    fmtDateTimePOS:value=>String(value),
    cashV2HistSafeTs:value=>value,
    Array, Error, Map, Set, String, Number
  };
  vm.createContext(cashSandbox);
  vm.runInContext(`${cashBlock}\nthis.buildEventCashExportSheetsPOS=buildEventCashExportSheetsPOS;`, cashSandbox);

  let sheets = await cashSandbox.buildEventCashExportSheetsPOS(10);
  assert.strictEqual(sheets[0].rows[0][1], 'Evento sin registros de caja', 'Evento sin caja no se representa correctamente');

  cashRows = [{eventId:10,dayKey:'2026-09-30',status:'OPEN'}];
  await assert.rejects(()=>cashSandbox.buildEventCashExportSheetsPOS(10), /caja abierta/i, 'El generador aceptó una caja abierta');

  cashRows = [{eventId:10,dayKey:'2026-09-30',status:'CLOSED',closeTs:30}];
  historyDays = [{dayKey:'2026-09-30'}];
  versionsByDay = {'2026-09-30':[1,2]};
  snapshots.set('2026-09-30|1',{ts:1,data:{meta:{audit:[]}}});
  snapshots.set('2026-09-30|2',{ts:2,data:{meta:{audit:[]}}});
  sheets = await cashSandbox.buildEventCashExportSheetsPOS(10);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(officialCalls.at(-1))), [{dayKey:'2026-09-30',v:2}], 'No se eligió la última versión diaria');
  const auditRows = sheets.find(sheet=>sheet.name === 'Caja_Auditoria').rows;
  assert.strictEqual(auditRows.filter(row=>row[4] === 'VERSION_CIERRE').length, 2, 'Auditoría no conserva todas las versiones');
  assert.strictEqual(auditRows.find(row=>row[2] === 1)[7], 'NO', 'Versión anterior figura como oficial');
  assert.strictEqual(auditRows.find(row=>row[2] === 2)[7], 'SI', 'Última versión no figura como oficial');

  const inventoryBlock = between(app, 'function eventInventoryProductForRefPOS(products, ref)', 'function buildEventSalesExportRowsPOS(sales, bankMap)');
  const products = [{id:1,productId:'prd-1',name:'Producto 1',manageStock:true}];
  const entries = [
    {id:1,eventId:10,productId:1,type:'init',qty:10,time:'2026-09-01',notes:'Inicial'},
    {id:2,eventId:10,productId:'prd-1',type:'restock',qty:5,time:'2026-09-02',notes:'Reposición'},
    {id:3,eventId:10,productId:1,type:'adjust',qty:-1,time:'2026-09-03',notes:'Merma'}
  ];
  const sales = [
    {eventId:10,productId:'prd-1',productName:'Producto 1',qty:4},
    {eventId:10,productId:'prd-historico',productName:'Producto eliminado',qty:2}
  ];
  const inventorySandbox = {
    async getAll(store){ return store === 'products' ? products : (store === 'inventory' ? entries : []); },
    catalogProductInternalIdPOS:p=>p.id,
    catalogProductStableIdPOS:p=>p.productId,
    findCatalogProductByStableIdPOS:(list,id)=>list.find(p=>p.productId === id) || null,
    saleMatchesCatalogProductPOS:(sale,product)=>String(sale.productId) === String(product.productId),
    saleProductIdForInventoryPOS:sale=>sale.productId,
    getSaleProductNameSnapshotPOS:sale=>sale.productName,
    lotCodeExcelCellPOS:value=>value,
    Array, Map, Set, String, Number
  };
  vm.createContext(inventorySandbox);
  vm.runInContext(`${inventoryBlock}\nthis.buildEventInventoryExportSheetsPOS=buildEventInventoryExportSheetsPOS;`, inventorySandbox);
  const inventorySheets = await inventorySandbox.buildEventInventoryExportSheetsPOS(10,sales);
  const productRow = inventorySheets.find(sheet=>sheet.name === 'Inventario_Resumen').rows[1];
  assert.deepStrictEqual(Array.from(productRow.slice(3)), [10,5,-1,4,10], 'Resumen de inventario no reconcilia inicial + reposición + ajuste - vendido');
  const historicalRow = inventorySheets.find(sheet=>sheet.name === 'Inventario_Resumen').rows.find(row=>row[1] === 'prd-historico');
  assert.ok(historicalRow, 'Una venta de producto histórico desapareció del inventario');
  assert.strictEqual(historicalRow[0], 'Producto eliminado', 'No se conservó el nombre histórico del producto');
  assert.strictEqual(inventorySheets.find(sheet=>sheet.name === 'Inventario_Movimientos').rows.length, 4, 'Detalle de inventario perdió movimientos');

  const writerBlock = between(app, 'async function exportEventClosureWorkbookPOS(eventId, options={})', 'async function generateCorteCSV(eventId, options={})');
  const appended = [];
  let writtenFilename = '';
  const writerSandbox = {
    async buildEventClosureSheetsPOS(){
      return {ev:{name:'Mi Evento'},sheets:[{name:'Resumen_Evento',rows:[[1]]},{name:'Caja_Resumen',rows:[[2]]}]};
    },
    XLSX:{
      utils:{
        book_new:()=>({}),
        aoa_to_sheet:rows=>({rows}),
        book_append_sheet(_workbook,_sheet,name){ appended.push(name); }
      },
      writeFile(_workbook,filename){ writtenFilename = filename; }
    },
    String
  };
  vm.createContext(writerSandbox);
  vm.runInContext(`${writerBlock}\nthis.exportEventClosureWorkbookPOS=exportEventClosureWorkbookPOS;`, writerSandbox);
  await writerSandbox.exportEventClosureWorkbookPOS(10);
  assert.deepStrictEqual(appended,['Resumen_Evento','Caja_Resumen'],'El escritor no agrega todas las hojas construidas');
  assert.strictEqual(writtenFilename,'cierre_evento_Mi Evento.xlsx','Nombre final del archivo inesperado');

  console.log('SMOKE OK — Suite A33 — POS cierre de evento — Excel integral Etapa 2');
})().catch(err=>{
  console.error(err);
  process.exitCode = 1;
});
