'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('../pos/vendor/xlsx.full.min.js');

const source = fs.readFileSync(path.join(__dirname, '../finanzas/script.js'), 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

(async () => {
  const filters = {
    '#er-modo':{value:'rango'}, '#er-desde':{value:'2026-11-01'}, '#er-hasta':{value:'2026-11-10'},
    '#er-evento':{value:'POS:1',selectedIndex:0,options:[{textContent:'Feria'}]}
  };
  const accountsMap = new Map([['4000',{tipo:'ingreso'}],['5000',{tipo:'costo'}],['6000',{tipo:'gasto'}]]);
  const linesByEntry = new Map([
    [1,[{accountCode:'4000',haber:1000.25},{accountCode:'5000',debe:300.1},{accountCode:'6000',debe:120}]],
    [2,[{accountCode:'4000',haber:9000}]],
    [3,[{accountCode:'4000',haber:8000}]]
  ]);
  let prefs = {identityFields:{taxId:false},privacy:{showProfit:true}};
  let workbook;
  let filename;
  const context = vm.createContext({
    $:selector=>filters[selector],
    window:{
      A33Storage:{
        getJSON:key=>key === 'suite_a33_identity_v1'
          ? {commercialName:'Mi Negocio',taxId:'RUC privado'}
          : prefs
      },
      A33Notice:{alert:message=>assert.fail(message)}
    },
    finCachedData:{
      accountsMap, linesByEntry,
      entries:[
        {id:1,fecha:'2026-11-05',posEventId:1},
        {id:2,fecha:'2026-11-05',posEventId:2},
        {id:3,fecha:'2026-10-28',posEventId:1}
      ]
    },
    getDisplayEventLabel:()=>'', getPosEventNameLiveById:()=>'', finPrimaryAmountHeader:()=> 'C$',
    todayStr:()=> '2026-11-11',
    showToast(){},
    XLSX:{...XLSX,writeFile(book,name){
      filename = name;
      workbook = XLSX.read(XLSX.write(book,{bookType:'xlsx',type:'buffer'}),{cellNF:true});
    }}
  });
  vm.runInContext(
    between('function finExcelMoneySheet(', 'function finAttachExportCurrencyMetadata(') +
    between('function getTipoCuenta(', '/* ---------- Compatibilidad financiera legacy') +
    between('function matchEvent(', '// Total de cortesías provenientes del POS.') +
    between('async function exportEstadoResultadosExcel(', 'async function exportBalanceGeneralExcel('),
    context
  );
  context.finAttachExportCurrencyMetadata = book=>{
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Moneda','NIO']]),'Moneda');
  };
  const values = () => new Map(XLSX.utils.sheet_to_json(workbook.Sheets.EstadoResultados,{header:1}).filter(row=>row.length));

  await context.exportEstadoResultadosExcel({share:true});
  assert.equal(filename,'finanzas_ER_compartir_2026-11-11.xlsx');
  assert.deepEqual(workbook.SheetNames,['EstadoResultados','Identidad','Moneda']);
  assert.equal(values().get('Periodo'),'2026-11-01 a 2026-11-10');
  assert.equal(values().get('Evento'),'Feria');
  assert.equal(values().get('Ingresos'),1000.25);
  assert.equal(workbook.Sheets.EstadoResultados.B6.z,'0.00');
  assert.doesNotMatch(XLSX.utils.sheet_to_csv(workbook.Sheets.EstadoResultados),/Costos|Gastos|Utilidad|4xxx/);
  assert.match(XLSX.utils.sheet_to_csv(workbook.Sheets.Identidad),/Mi Negocio/);
  assert.doesNotMatch(XLSX.utils.sheet_to_csv(workbook.Sheets.Identidad),/RUC privado/);

  prefs = {identityFields:{commercialName:false,taxId:false},privacy:{showCosts:true}};
  await context.exportEstadoResultadosExcel({share:true});
  assert.equal(values().get('Costos de venta'),300.1);
  assert.equal(values().get('Gastos de operación'),120);
  assert.ok(!values().has('Utilidad bruta'));
  assert.ok(!workbook.Sheets.Identidad);

  prefs.privacy.showProfit = true;
  await context.exportEstadoResultadosExcel({share:true});
  assert.equal(values().get('Utilidad bruta'),700.15);
  assert.equal(values().get('Utilidad neta'),580.15);

  prefs = {};
  await context.exportEstadoResultadosExcel();
  assert.equal(filename,'finanzas_ER_2026-11-11.xlsx');
  assert.deepEqual(workbook.SheetNames,['EstadoResultados','Moneda']);
  assert.equal(values().get('Ingresos (4xxx)'),1000.25);
  assert.equal(values().get('Costos de venta (5xxx)'),300.1);
  assert.equal(values().get('Gastos de operación (6xxx)'),120);
  assert.equal(values().get('Utilidad neta'),580.15);

  console.log('SMOKE OK — Finanzas — Estado de Resultados para compartir y exportación completa');
})().catch(error=>{ console.error(error); process.exitCode = 1; });
