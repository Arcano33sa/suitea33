'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const XLSX = require('../pos/vendor/xlsx.full.min.js');

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
      ],fmt:{Resumen:{cols2dec:[4]},Movimientos:{cols2dec:[5]},Conteo:{cols2dec:[7,8]}}};
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
  let writtenFilename = '';
  let exported;
  const writerSandbox = {
    async buildEventClosureSheetsPOS(){
      return {ev:{name:'Mi Evento'},sheets:[
        {name:'Resumen_Evento',rows:[['ID',10],['Venta neta C$',230],['Cortesías (unid.)',1]]},
        {name:'Caja_Resumen',rows:[['eventId','día','versión','fecha','monto'],[10,'',1,'',12.5]],moneyFormat:{cols2dec:[4],startRowIdx:1}}
      ]};
    },
    XLSX:{...XLSX,writeFile(workbook,filename){
      writtenFilename = filename;
      exported = XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{cellNF:true});
    }}
  };
  const moneyHelper = source=>between(source, 'function posExportMoneySheet(', 'function writeWorkbookFromSheetsPOS(');
  const cashFormat = between(app, 'function cashV2HistExcelApply2Dec(', 'function cashV2HistWriteWorkbookExcel(');
  vm.createContext(writerSandbox);
  vm.runInContext(moneyHelper(app) + cashFormat + writerBlock, writerSandbox);
  await writerSandbox.exportEventClosureWorkbookPOS(10);
  assert.deepStrictEqual(exported.SheetNames,['Resumen_Evento','Caja_Resumen']);
  assert.strictEqual(writtenFilename,'cierre_evento_Mi Evento.xlsx');
  assert.strictEqual(exported.Sheets.Resumen_Evento.B1.z,'General');
  assert.strictEqual(exported.Sheets.Resumen_Evento.B2.w,'230.00');
  assert.strictEqual(exported.Sheets.Resumen_Evento.B3.z,'General');
  assert.strictEqual(exported.Sheets.Caja_Resumen.E2.w,'12.50');
  assert.strictEqual(exported.Sheets.Caja_Resumen.C2.z,'General');

  for (const source of [app, fs.readFileSync(path.join(root, 'pruebas/pos/app.js'), 'utf8')]){
    const context = vm.createContext({XLSX});
    vm.runInContext(moneyHelper(source),context);
    const book = XLSX.utils.book_new();
    for (const [name,rows] of [
      ['Corte',[['Efectivo',230],['Merma final del evento (ml)','0.1234'],['Detalle de ventas'],
        ['id','cant','PU','desc_C$','total','T/C usado','USD recibido'],[1,2,115,0,230.125,'36.50','10.00']]],
      ['Reempaque',[['Costo origen total','Costo por ml'],[230,0.0032]]],
      ['PorProducto',[['Producto','Vendido','Total C$'],['Galón',2,230]]],
      ['Eventos',[['id','evento','total'],[1,'Evento',230]]],
      ['Resumen',[['Eventos incluidos',1],['Banco','Total C$','Transacciones'],['Banco A',230,2]]]
    ]) XLSX.utils.book_append_sheet(book,context.posExportMoneySheet(rows,name),name);
    const {Sheets} = XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{cellNF:true});
    assert.strictEqual(Sheets.Corte.B1.w,'230.00');
    assert.strictEqual(Sheets.Corte.B2.v,'0.1234');
    assert.strictEqual(Sheets.Corte.B5.z,'General');
    assert.strictEqual(Sheets.Corte.C5.w,'115.00');
    assert.strictEqual(Sheets.Corte.D5.w,'0.00');
    assert.strictEqual(Sheets.Corte.E5.v,230.125);
    assert.strictEqual(Sheets.Corte.E5.z,'0.00');
    assert.strictEqual(Sheets.Corte.F5.t,'s');
    assert.strictEqual(Sheets.Corte.G5.t,'n');
    assert.strictEqual(Sheets.Reempaque.B2.v,0.0032);
    assert.strictEqual(Sheets.Reempaque.B2.z,'General');
    assert.strictEqual(Sheets.PorProducto.C2.w,'230.00');
    assert.strictEqual(Sheets.Eventos.C2.w,'230.00');
    assert.strictEqual(Sheets.Resumen.B1.z,'General');
    assert.strictEqual(Sheets.Resumen.B3.w,'230.00');
    assert.strictEqual(Sheets.Resumen.C3.z,'General');
  }

  console.log('SMOKE OK — Suite A33 — POS cierre de evento — Excel integral Etapa 2');
})().catch(err=>{
  console.error(err);
  process.exitCode = 1;
});
