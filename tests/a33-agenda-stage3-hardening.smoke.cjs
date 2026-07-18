const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));
const checks = [];
function check(name, fn){ fn(); checks.push(name); }
function includes(rel, needles){ const s=read(rel); needles.forEach(n=>assert.ok(s.includes(n), `${rel}: falta ${n}`)); }

check('1 proyecto completo', ()=>['index.html','agenda/index.html','catalogos/index.html','centro-mando/index.html','configuracion/index.html','finanzas','inventario','pos','calculadora','lotes'].forEach(x=>assert.ok(exists(x),`falta ${x}`)));
check('2 portada Agenda', ()=>includes('agenda/index.html',['id="agendaHomeView"','data-agenda-section="reunion"','data-agenda-section="tarea"','data-agenda-section="compra"']));
check('3 Compras separada', ()=>includes('agenda/index.html',['id="agendaPurchasesView"','id="purchaseForm"','id="purchaseList"']));
check('4 regreso Agenda', ()=>assert.ok((read('agenda/index.html').match(/data-agenda-back/g)||[]).length>=2));
check('5 fuente Materia Prima', ()=>includes('agenda/purchases.js',["window.A33Materials.listActive()","materials_contract_missing"]));
check('6 solo activos', ()=>includes('assets/js/a33-materials.js',['filter(function(row){ return row && row.active !== false; })']));
check('7 selector no manual', ()=>{ const h=read('agenda/index.html'); assert.ok(/<select id="purchaseMaterial"/.test(h)); assert.ok(!/<input[^>]+id="purchaseMaterial"/.test(h)); });
check('8 campos históricos readonly', ()=>includes('agenda/index.html',['id="purchaseCategory" type="text" readonly','id="purchaseUnit" type="text" readonly','id="purchasePrice" type="text" readonly','id="purchaseSubtotal" type="text" readonly']));
check('9 unidades controladas', ()=>includes('agenda/purchases.js',["['Unidad','Cajas','Litros','Galones']","UNIT_SET"]));
check('10 cantidad móvil', ()=>includes('agenda/index.html',['id="purchaseQuantity" type="number"','inputmode="decimal"','placeholder="Ej. 2"']));
check('11 doble toque', ()=>includes('agenda/purchases.js',['state.saving','if (!validated || state.saving) return false']));
check('12 fotografía de precio', ()=>includes('agenda/purchases.js',['priceUsed: snapshot.priceUsed','capturedAt: existing && existing.purchase.snapshot.capturedAt']));
check('13 subtotal', ()=>includes('agenda/purchases.js',['round2(snapshot.priceUsed * validated.quantity)','syncSubtotal']));
check('14 estados', ()=>includes('agenda/purchases.js',["pendiente:'Pendiente'","hecho:'Hecho'","cancelado:'Cancelado'"]));
check('15 presupuesto', ()=>includes('agenda/index.html',['Presupuesto pendiente','Total comprado','Compras pendientes','Compras realizadas']));
check('16 totales por estado', ()=>includes('agenda/purchases.js',["item.status === 'pendiente'","item.status === 'hecho'"]));
check('17 listado solo compras', ()=>includes('agenda/purchases.js',["item && item.type","=== 'compra'"]));
check('18 edición protegida', ()=>includes('agenda/purchases.js',['refs.material.disabled = true','Artículo, categoría, unidad y precio histórico bloqueados']));
check('19 filtros de histórico', ()=>includes('agenda/index.html',['data-purchase-filter="pendiente"','data-purchase-filter="hecho"','data-purchase-filter="cancelado"','data-purchase-filter="todos"']));
check('20 ICS agrupado', ()=>includes('agenda/purchases.js',['function pendingGroups','function buildCalendar(groups)','groups.forEach(function(records,date)']));
check('21 título ICS', ()=>includes('agenda/purchases.js',["SUMMARY:' + icsEscape('Compras Arcano 33')","Presupuesto estimado:"]));
check('22 solo pendientes ICS', ()=>includes('agenda/purchases.js',["item.status === 'pendiente' && item.date"]));
check('23 exportaciones', ()=>includes('agenda/index.html',['id="purchaseExportDateBtn"','id="purchaseExportAllBtn"']));
check('24 Centro de Mando', ()=>includes('centro-mando/app.js',["compra:'Compra'","record.type === 'compra'","Compra planificada"]));
check('25 JSON completo', ()=>includes('configuracion/script.js',["SUITE_LS_PREFIXES","Agenda (Reuniones, Tareas y Compras)","store: 'rawMaterials'"]));
check('26 JSON dependencia', ()=>includes('configuracion/script.js',['hasAgenda && !hasMateriaPrima','Catálogos → Materia Prima']));
check('27 Firestore principal', ()=>includes('firestore.rules',["|| type == 'compra'","function validAgendaPurchase","match /agendaRecords/{recordId}"]));
check('28 Firestore alterno', ()=>includes('firebase/firestore.rules',["type == 'compra'","function validAgendaPurchase","match /agendaRecords/{recordId}"]));
check('29 PWA Agenda', ()=>['agenda/manifest.webmanifest','agenda/offline.html','agenda/sw.js'].forEach(x=>assert.ok(exists(x),`falta ${x}`)));
check('30 responsive/sin ancho general', ()=>includes('agenda/style.css',['@media (max-width:980px)','@media (max-width:740px)','grid-template-columns:1fr']));

// Integridad básica de reglas y recursos del SW.
for (const rel of ['firestore.rules','firebase/firestore.rules']){
  const s=read(rel); let depth=0;
  for (const ch of s){ if(ch==='{') depth++; else if(ch==='}') depth--; assert.ok(depth>=0,`${rel}: llaves desbalanceadas`); }
  assert.strictEqual(depth,0,`${rel}: llaves desbalanceadas`);
}
const sw=read('agenda/sw.js');
for (const ref of [...sw.matchAll(/["']((?:\.\.?\/)[^"']+)["']/g)].map(m=>m[1].split('?')[0])){
  assert.ok(exists(path.join('agenda',ref)),`SW referencia inexistente: ${ref}`);
}

console.log(`Agenda Etapa 3 hardening smoke: OK (${checks.length}/30)`);
