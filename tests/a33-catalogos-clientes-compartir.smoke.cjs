'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('../pos/vendor/xlsx.full.min.js');

const source = fs.readFileSync(path.join(__dirname,'../catalogos/script.js'),'utf8');
const markup = fs.readFileSync(path.join(__dirname,'../catalogos/index.html'),'utf8');
const start = source.indexOf('  function buildCustomerExportRowsCAT(');
const end = source.indexOf('  function updateLastPurchaseForTargetCAT(',start);
assert.ok(start >= 0 && end > start);
assert.match(source,/function bindCustomerUi\(\)\{\s*bindCustomerShareUiCAT\(\)/);
assert.match(markup,/id="cat-share-customers-download"[^>]* disabled/);

(async()=>{
  const customers = [
    {id:'1',name:'Ana privada',cell:'0002',active:true},
    {id:'2',name:'Zoe privada',cell:'0001',active:true}
  ];
  const sales = [
    {id:'s1',customerId:'1',date:'2026-11-02',total:120},
    {id:'s2',customerId:'1',date:'2026-11-04',total:20,isReturn:true},
    {id:'s3',customerId:'2',date:'2026-11-07',total:45}
  ];
  const reads = [];
  let workbook;
  let filename;
  const context = vm.createContext({
    Date,
    XLSX:{...XLSX,writeFile(book,name){
      filename = name;
      workbook = XLSX.read(XLSX.write(book,{bookType:'xlsx',type:'buffer'}),{cellDates:true,cellNF:true});
    }},
    readCustomerCatalogCAT:()=>customers,
    getCustomerCellularCAT:customer=>customer.cell,
    customerActiveCAT:customer=>customer.active,
    async openDB(){ reads.push('open'); },
    async getAll(store){ reads.push(store); return store === 'sales' ? sales : []; },
    buildCustomerPurchaseResolverCAT:rows=>({
      idTargets:new Map(rows.map(customer=>[customer.id,new Set([customer.id])])),
      nameTargets:new Map()
    }),
    saleCustomerIdCAT:sale=>sale.customerId,
    saleDateKeyCAT:sale=>sale.date,
    archivedSalesFromSnapshotCAT:()=>[]
  });
  vm.runInContext(source.slice(start,end),context);
  const rows = ()=>XLSX.utils.sheet_to_json(workbook.Sheets.Clientes,{header:1});
  const csv = ()=>XLSX.utils.sheet_to_csv(workbook.Sheets.Clientes);

  await context.exportCustomersForSharingCAT({});
  assert.equal(workbook,undefined);
  await context.exportCustomersForSharingCAT({includePhone:true});
  assert.equal(filename,'A33_Clientes_Compartir.xlsx');
  assert.deepEqual(rows(),[['Celular'],['0001'],['0002']]);
  assert.deepEqual(reads,[]);
  assert.doesNotMatch(csv(),/privada|Activo|Historial/);

  await context.exportCustomersForSharingCAT({includeName:true});
  assert.deepEqual(rows(),[['Nombre'],['Ana privada'],['Zoe privada']]);
  assert.deepEqual(reads,[]);

  await context.exportCustomersForSharingCAT({includeHistory:true});
  assert.deepEqual(reads,['open','sales','summaryArchives']);
  assert.deepEqual(rows()[0],['Última fecha de compra','Total comprado neto (C$) · Historial disponible','Observación']);
  assert.equal(workbook.Sheets.Clientes.A2.t,'d');
  assert.equal(workbook.Sheets.Clientes.B2.z,'#,##0.00');
  assert.deepEqual(rows().slice(1).map(row=>row[1]).sort((a,b)=>a-b),[45,100]);
  assert.doesNotMatch(csv(),/privada|0001|0002|Activo/);

  await context.exportCustomersForSharingCAT({includeName:true,includePhone:true,includeHistory:true});
  assert.equal(rows()[1][0],'Ana privada');
  assert.equal(rows()[1][1],'0002');
  assert.equal(rows()[1][3],100);
  assert.equal(workbook.Sheets.Clientes.D2.z,'#,##0.00');
  assert.ok(!rows()[0].includes('Estado'));

  await context.exportCustomersExcelCAT();
  assert.equal(filename,'A33_Clientes.xlsx');
  assert.deepEqual(rows()[0],['Nombre','Celular','Estado','Última fecha de compra','Total comprado neto (C$) · Historial disponible','Observación']);
  assert.equal(rows()[1][2],'Activo');
  assert.equal(workbook.Sheets.Clientes.E2.z,'#,##0.00');

  console.log('SMOKE OK — Catálogos — exportación selectiva y completa de clientes');
})().catch(error=>{console.error(error);process.exitCode=1;});
