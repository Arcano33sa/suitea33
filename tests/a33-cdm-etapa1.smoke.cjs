'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'centro-mando', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'centro-mando', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'centro-mando', 'style.css'), 'utf8');

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const forbidden = [
  /checklist/i,
  /recordatorio/i,
  /recomendaci/i,
  /top productos/i,
  /mini radar/i,
  /posRemindersIndex/i,
  /a33_analytics_recos_v1/i,
  /FIN_COMPRAS_CURRENT_KEY/,
  /btnGoChecklist/,
  /btnOpenChecklist/,
  /checklistProgress/,
  /checklistHint/,
  /radarNoStock/
];
for (const pattern of forbidden){
  check(!pattern.test(html + '\n' + js), `Referencia retirada todavía presente: ${pattern}`);
}

const sections = [
  'operationalHeader',
  'todaySummaryBlock',
  'attentionBlock',
  'ordersBlock',
  'agendaBlock',
  'inventoryBlock',
  'globalActivesBlock'
];
let last = -1;
for (const id of sections){
  const index = html.indexOf(`id="${id}"`);
  check(index >= 0, `Falta bloque ${id}`);
  check(index > last, `Orden incorrecto para ${id}`);
  last = index;
}

check(/id="btnUseInPOS"/.test(html), 'Falta botón Usar en POS');
check(/id="usePosModal"/.test(html), 'Falta confirmación explícita para Usar en POS');
check(/id="posActiveEventName"/.test(html), 'Falta indicador de evento activo en POS');
check(/id="eventSearch"/.test(html), 'Falta selector de evento visualizado');
check(/id="globalActivesBlock"[^>]*hidden/.test(html), 'Eventos activos debe iniciar oculto');
check(/\.cmd-block\s*\{[^}]*width\s*:\s*100%/s.test(css), 'Los bloques no están blindados a ancho completo');

const currentEventWrites = js.match(/setMetaValue\(\s*['"]currentEventId['"]/g) || [];
check(currentEventWrites.length === 1, `Debe existir una sola escritura explícita de currentEventId; encontradas ${currentEventWrites.length}`);
check(/async function activateVisualizedEventInPos\(\)[\s\S]*setMetaValue\(\s*['"]currentEventId['"]/m.test(js), 'La escritura no está encapsulada en la confirmación explícita');

const selectVisualBody = (js.match(/async function selectVisualEvent\([^)]*\)\{([\s\S]*?)\n\}/m) || [,''])[1];
check(!/currentEventId|setMetaValue/.test(selectVisualBody), 'Seleccionar evento visualizado altera el POS');
const selectGlobalBody = (js.match(/async function selectGlobalView\([^)]*\)\{([\s\S]*?)\n\}/m) || [,''])[1];
check(!/currentEventId|setMetaValue/.test(selectGlobalBody), 'Seleccionar GLOBAL altera el POS');
const navigateBody = (js.match(/function navigate\([^)]*\)\{([\s\S]*?)\n\}/m) || [,''])[1];
check(!/currentEventId|setMetaValue/.test(navigateBody), 'La navegación cambia el evento activo');

check(/window\.__A33_CDM_STAGE1/.test(js), 'Falta diagnóstico de Etapa 1');
check(!/<script[^>]+a33-presentations/i.test(html), 'Carga innecesaria heredada todavía presente');

if (failures.length){
  console.error('SMOKE FAIL');
  failures.forEach((failure)=>console.error('- ' + failure));
  process.exit(1);
}

console.log('SMOKE OK');
console.log('- Limpieza heredada verificada');
console.log('- Separación evento visualizado / evento activo POS verificada');
console.log('- Única escritura currentEventId detrás de confirmación explícita');
console.log('- Orden vertical de 7 bloques verificado');
console.log('- Sintaxis JS debe validarse además con node --check');
