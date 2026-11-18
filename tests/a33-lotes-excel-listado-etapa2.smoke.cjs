'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('../lotes/vendor/xlsx.full.min.js');
const source = fs.readFileSync(path.join(__dirname, '../lotes/script.js'), 'utf8');
const current = [
  { id:'live', codigo:'001', createdAt:'2026-11-17T12:00:00Z', fecha:'2026-10-01', caducidad:'2026-12-01', notas:'Nota\nñ',
    productosProducidos:[{productId:'d',Letra:'D',cantidad:6},{productId:'x',Letra:'X',cantidad:3}] },
  { id:'sold', codigo:'002', createdAt:'2026-11-16T12:00:00Z', assignedEventId:'e', assignedEventName:'Feria',
    productosProducidos:[{productId:'d',Letra:'D',cantidad:6}], eventUsage:{ e:{remainingByProductId:{d:0},remainingByLetter:{D:0}} } },
  { id:'closed',codigo:'003',createdAt:'2026-11-15T12:00:00Z',status:'CERRADO' },
  { id:'event',codigo:'004',createdAt:'2026-11-14T12:00:00Z',assignedEventId:'e',assignedEventName:'Feria',djeba:'4' },
];
const archived = [
  {originalId:'old',codigo:'0005',createdAt:'2026-11-18T12:00:00Z',deletedAt:'2026-11-18T13:00:00Z',djeba:'6',notas:'Más reciente'},
  {originalId:'old',codigo:'0005',createdAt:'2026-11-18T12:00:00Z',deletedAt:'2026-11-18T12:00:00Z',notas:'Duplicado'},
  {originalId:'live',codigo:'001',createdAt:'2026-11-17T12:00:00Z'},
  {originalId:'lote_1700000000000',codigo:'006',pulso:'12'},
];
const before = JSON.stringify({current,archived});
let captured, filename;
const notices = [];
const btn = {textContent:'Exportar a Excel',setAttribute(){},removeAttribute(){}};
const ctx = vm.createContext({ console, setTimeout(){}, clearTimeout(){},
  localStorage:{getItem(){return null;},setItem(){throw Error('No debe escribir datos');}},
  document:{ addEventListener(){},getElementById(id){return id === 'export-btn' ? btn : null;},querySelectorAll(){return [];} },
  window:{A33Notice:{alert:message=>notices.push(message),show(){}}}, navigator:{},matchMedia:()=>({matches:false}),
  XLSX:{...XLSX,writeFile(wb,name){captured = XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});filename=name;}},
  current,archived });
ctx.window.matchMedia = ctx.matchMedia;
vm.runInContext(source,ctx);
vm.runInContext('loadLotes = () => current; loadArchivedLotes = () => archived; exportToCSV()',ctx);
assert.equal(notices.length,0);
assert.match(filename,/^arcano33_lotes_.*\.xlsx$/);
const sheet = captured.Sheets.Lotes;
const rows = XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
assert.deepEqual(rows[0],['Código','Estado','Evento','Creado','Elaborado','Caducidad','Productos','Notas']);
assert.deepEqual(rows.slice(1).map(row=>row[0]),['0005','001','002','003','004','006']);
assert.deepEqual(rows.slice(1).map(row=>row[1]),['Eliminado','Disponible','Vendido','Cerrado','En evento','Eliminado']);
assert.equal(sheet.A2.t,'s');
assert.equal(rows[1][6],'D6');
assert.equal(rows[1][7],'Más reciente');
assert.equal(rows[1][4],''); assert.equal(rows[1][5],'');
assert.match(rows[2][6],/D6/); assert.match(rows[2][6],/X3/);
assert.equal(rows[2][7],'Nota\nñ');
assert.equal(rows[3][2],'Feria'); assert.equal(rows[3][6],'D6','Exporta producción original aunque esté vendido');
assert.equal(rows[6][6],'P12'); assert(rows[6][3], 'Recupera creación desde originalId histórico');
assert.equal(JSON.stringify({current,archived}),before);
assert.equal(btn.disabled,false);
// También permite exportar cuando solo queda histórico y controla lista vacía.
ctx.current=[]; vm.runInContext('exportToCSV()',ctx);
assert.equal(XLSX.utils.sheet_to_json(captured.Sheets.Lotes).length,3);
ctx.archived=[]; captured=null; vm.runInContext('exportToCSV()',ctx);
assert.equal(captured,null); assert.equal(notices.pop(),'No hay lotes para exportar.');
console.log('OK: XLSX real, columnas, orden, estados, letras/cantidades originales, ceros iniciales, duplicados, históricos incompletos y exportación sin activos; datos intactos.');
