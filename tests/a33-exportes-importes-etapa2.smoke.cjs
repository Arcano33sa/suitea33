'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('../pos/vendor/xlsx.full.min.js');

function block(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function readModule(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function roundTrip(book) {
  return XLSX.read(XLSX.write(book, { type:'buffer', bookType:'xlsx' }), { cellNF:true });
}

function money(cell, value) {
  assert.equal(cell.t, 'n');
  assert.equal(cell.z, '0.00');
  assert.equal(cell.v, value);
}

(async () => {
  for (const prefix of ['', 'pruebas/']) {
    const finance = readModule(prefix + 'finanzas/script.js');
    let ledger;
    const financeContext = vm.createContext({
      XLSX:{ ...XLSX, writeFile(book){ ledger = roundTrip(book).Sheets.ResumenMoneda; } },
      finAttachExportCurrencyMetadata(){},
      finMoneyColumnHeader:label=>label,
      pcComputeTotalsFromSections:()=>({ proveedores:230, varias:0, general:230 }),
      pcComputeProductSummary:()=>[{ product:'Producto', qty:2, total:230 }],
      pcParseNum:Number,
      pcGetLineTotal:line=>line.price * line.quantity
    });
    vm.runInContext(
      block(finance, 'function finExcelMoneySheet(', 'function finAttachExportCurrencyMetadata(') +
      block(finance, 'function finExportReportWorkbook(', 'async function exportMayorReportExcel(') +
      block(finance, 'function pcBuildWorkbook(', 'function pcExportCurrentExcel('),
      financeContext
    );
    financeContext.finExportReportWorkbook('ResumenMoneda', [
      ['Resumen'], ['Periodo'], ['Exportado'], [], ['Moneda'],
      ['NIO',230,0,230,0,1], ['USD',10,0,365,0,1], ['Total',595], [], ['Fecha'],
      ['2026-10-01','1101','','','USD',10,365,36.5]
    ], 'reporte.xlsx');
    money(ledger.B6,230);
    money(ledger.B7,10);
    money(ledger.B8,595);
    money(ledger.G11,365);
    assert.equal(ledger.H11.z,'General');
    assert.equal(ledger.F7.z,'General');
    const purchases = roundTrip(financeContext.pcBuildWorkbook({
      sections:{ proveedores:[{product:'Producto',quantity:2,price:115}], varias:[] }
    })).Sheets;
    money(purchases.Resumen.B7,230);
    money(purchases['Compras Proveedores'].E2,115);
    assert.equal(purchases['Compras Proveedores'].D2.z,'General');

    const orders = readModule(prefix + 'pedidos/script.js');
    let orderSheets;
    const orderContext = vm.createContext({
      XLSX:{ ...XLSX, writeFile(book){ orderSheets = roundTrip(book).Sheets; } },
      window:{ A33Notice:{ show(){}, alert(message){ throw new Error(message); } } },
      console, setTimeout, $:()=>null,
      loadPedidos:()=>[{ id:1, codigo:'001' }],
      loadQuickOrdersPED:()=>[],
      getPedidoTotalsForDisplayPED:()=>({
        lines:[{ productId:'p1', label:'Producto', qty:2, unit:115.125, subtotal:230.25 }],
        subtotal:230.25, total:230.25, descuento:0, envio:0, pagoAnt:100, saldo:130.25
      }),
      getPedidoEstado:()=> 'pendiente',
      pedidoEstadoLabelPED:value=>value,
      formatDate:()=> '',
      buildPedidoProductsExportTextPED:()=> '',
      getPedidoSubtotalFromLinesPED:()=>230.25,
      pedidoEntregasLineasPED:()=>[],
      readPedidoLotesCatalogPED:()=>({ rows:[] }),
      pedidoLotesRegistroValidoPED:()=>true
    });
    vm.runInContext(block(orders, 'async function exportToCSV()', "window.addEventListener('storage'"), orderContext);
    await orderContext.exportToCSV();
    const main = orderSheets.Pedidos;
    const headers = XLSX.utils.sheet_to_json(main,{header:1})[0];
    const cell = label=>main[XLSX.utils.encode_cell({r:1,c:headers.indexOf(label)})];
    money(cell('Producto [p1] - Precio'),115.125);
    money(cell('Monto pagado'),100);
    money(cell('Saldo pendiente'),130.25);
    assert.equal(cell('Producto [p1] - Cantidad').z,'General');
    money(orderSheets['Detalle productos'].H2,115.125);
  }
  console.log('SMOKE OK — Importes Excel de Finanzas y Pedidos');
})().catch(error=>{
  console.error(error);
  process.exitCode = 1;
});
