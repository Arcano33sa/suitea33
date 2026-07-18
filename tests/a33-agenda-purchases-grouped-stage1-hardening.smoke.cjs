const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname,'..');
const read = rel => fs.readFileSync(path.join(root,rel),'utf8');
const exists = rel => fs.existsSync(path.join(root,rel));
const checks=[];
function check(name,fn){ fn(); checks.push(name); }
function includes(rel,needles){ const s=read(rel); needles.forEach(n=>assert.ok(s.includes(n),`${rel}: falta ${n}`)); }

check('1 proyecto completo',()=>['index.html','agenda/index.html','agenda/script.js','agenda/purchases.js','agenda/style.css','agenda/sw.js','catalogos','centro-mando','configuracion','finanzas','inventario','pos','calculadora','lotes'].forEach(x=>assert.ok(exists(x),`falta ${x}`)));
check('2 botón Agregar',()=>includes('agenda/index.html',['id="purchaseAddBtn"','>Agregar</button>','purchase-status-add-row']));
check('3 ubicación junto a Estado',()=>{ const h=read('agenda/index.html'); const row=h.slice(h.indexOf('purchase-status-add-row'),h.indexOf('purchase-status-add-row')+900); assert.ok(row.includes('id="purchaseStatus"')); assert.ok(row.includes('id="purchaseAddBtn"')); });
check('4 selector Materia Prima',()=>{ const h=read('agenda/index.html'); assert.ok(/<select id="purchaseMaterial"/.test(h)); assert.ok(!/<input[^>]+id="purchaseMaterial"/.test(h)); });
check('5 solo activos',()=>includes('agenda/purchases.js',['window.A33Materials.listActive()','item.active !== false']));
check('6 campos generales',()=>includes('agenda/index.html',['id="purchaseDate"','id="purchasePriority"','id="purchaseStatus"','id="purchaseNotes"']));
check('7 retención artículo',()=>includes('agenda/purchases.js',['function clearArticleInputs','refs.material.value = \'\'','refs.quantity.value = \'\'','Agrega artículos; Fecha necesaria, Prioridad, Estado y Notas se mantienen']));
check('8 lista temporal',()=>includes('agenda/index.html',['Artículos agregados','id="purchaseDraftList"','id="purchaseDraftCount"']));
check('9 total temporal',()=>includes('agenda/index.html',['Total de la compra planificada:','id="purchaseDraftTotal"']));
check('10 validación artículo',()=>includes('agenda/purchases.js',['function validateArticle','La cantidad debe ser numérica y mayor que cero.','Selecciona un artículo activo de Materia Prima.']));
check('11 decimales e enteros',()=>includes('agenda/purchases.js',["INTEGER_UNITS = new Set(['Unidad','Cajas'])","INTEGER_UNITS.has(snapshot.unit)","'0.01'"]));
check('12 doble toque',()=>includes('agenda/purchases.js',['state.saving','state.adding','if (state.saving) return false','if (state.adding) return false']));
check('13 fotografía histórica',()=>includes('agenda/purchases.js',['priceUsed: validated.snapshot.priceUsed','capturedAt: now','existing.priceUsed']));
check('14 repetidos se fusionan',()=>includes('agenda/purchases.js',['const incomingIdentity = itemIdentity(validated.snapshot)','existing.quantity = round2','existing.subtotal = round2']));
check('15 edición temporal',()=>includes('agenda/purchases.js',['function startDraftEdit','function saveDraftEdit','Editar cantidad de ','item.subtotal = round2(item.priceUsed * quantity)']));
check('16 quitar temporal',()=>includes('agenda/purchases.js',['function removeDraftItem',"'Quitar ' + item.name"]));
check('17 último sin agregar',()=>includes('agenda/purchases.js',['function pendingArticleInputs','pendingArticleInputs() && !addDraftItem','Completa correctamente el último artículo']));
check('18 una compra agrupada',()=>includes('agenda/purchases.js',['purchaseGroup','itemCount','totalGeneral','Compra agrupada · ']));
check('19 reset después de guardar',()=>includes('agenda/purchases.js',['resetForm({ focus:false, statusMessage:message })','refs.priority.value = \'media\'','refs.status.value = \'pendiente\'']));
check('20 Nuevo confirma descarte',()=>includes('agenda/purchases.js',['Hay artículos agregados sin guardar','window.confirm','requestNew']));
check('21 normalización legado',()=>includes('agenda/purchases.js',['function extractGroupItems','const legacyRaw','return validPurchaseItem(legacy) ? [legacy] : []']));
check('22 normalizador general preserva grupos',()=>includes('agenda/script.js',['function normalizePurchaseGroup','purchaseGroup: type === \'compra\'','totalGeneral']));
check('23 presupuesto usa total agrupado',()=>includes('agenda/purchases.js',['function purchaseTotal','record.purchaseGroup.totalGeneral','updateBudget']));
check('24 calendario compatible',()=>includes('agenda/purchases.js',['record.purchaseGroup && Array.isArray(record.purchaseGroup.items)','Presupuesto estimado:']));
check('25 responsive',()=>includes('agenda/style.css',['.purchase-status-add-row','.purchase-draft-row','@media (max-width:740px)','@media (max-width:420px)']));
check('26 táctil',()=>includes('agenda/style.css',['touch-action:manipulation','min-height:48px']));
check('27 sin dependencia nueva',()=>{ const h=read('agenda/index.html'); assert.ok(!h.includes('node_modules')); assert.ok(!h.includes('cdn.jsdelivr.net')); });
check('28 PWA cache actualizado',()=>includes('agenda/sw.js',['agenda-r${REV}-m4','./purchases.js?v=4.20.95&r=4','./style.css?v=4.20.95&r=11','./script.js?v=4.20.95&r=16']));
check('29 versiones HTML coherentes',()=>includes('agenda/index.html',['style.css?v=4.20.95&r=11','script.js?v=4.20.95&r=16','purchases.js?v=4.20.95&r=4']));
check('30 no toca inventario/finanzas/POS',()=>{ const s=read('agenda/purchases.js'); ['inventario','finanzas','pos/','caja','bancos'].forEach(term=>assert.ok(!s.toLowerCase().includes('localstorage.setitem(\''+term),term)); });

for (const rel of ['agenda/purchases.js','agenda/script.js']){
  const s=read(rel); let depth=0;
  for(const ch of s){ if(ch==='{') depth++; else if(ch==='}') depth--; assert.ok(depth>=0,`${rel}: llaves`); }
  assert.strictEqual(depth,0,`${rel}: llaves`);
}
const sw=read('agenda/sw.js');
for(const ref of [...sw.matchAll(/["']((?:\.\.?\/)[^"']+)["']/g)].map(m=>m[1].split('?')[0])){
  assert.ok(exists(path.join('agenda',ref)),`SW referencia inexistente: ${ref}`);
}
console.log(`Agenda Compras Agrupadas Etapa 1 hardening: OK (${checks.length}/30)`);
