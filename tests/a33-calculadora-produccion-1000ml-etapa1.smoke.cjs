'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'calculadora/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'calculadora/sw.js'), 'utf8');

assert.ok(html.includes('id="btn-produccion"'), 'Falta botón Producción');
assert.ok(html.includes('id="a33-modal-produccion"'), 'Falta modal Producción');
assert.ok(html.includes('id="a33-produccion-cancelar"'), 'Falta Cancelar');
assert.ok(html.includes('id="a33-produccion-guardar"'), 'Falta Guardar');
assert.ok(!html.includes('Guardar en Checklist'), 'El botón debe llamarse solamente Guardar');
assert.ok(html.includes('const A33_PRODUCTION_CHECKLIST_STORAGE_KEY = "arcano33_produccion_checklists";'), 'Falta almacenamiento independiente');
assert.ok(html.includes('origenChecklist:"produccion-1000ml"'), 'Falta identidad de producción independiente');
assert.ok(html.includes('formulaSnapshot:{ ...A33_PRODUCTION_FORMULA }'), 'Falta snapshot histórico de fórmula');
assert.ok(!html.slice(html.indexOf('function a33SaveProductionChecklist()'), html.indexOf('function a33ChecklistNumber')).includes('commitOfficialProduction'), 'Guardar no debe crear producción oficial');
assert.ok(html.includes('navigator.serviceWorker.register("./sw.js?v=4.20.98&r=13")'), 'Registro SW no actualizado');
assert.ok(sw.includes("const MODULE_CACHE_REV = '14';"), 'Cache del módulo no incrementado');
assert.ok(sw.includes("'./index.html?v=4.20.98&r=22'"), 'Precache no apunta al HTML nuevo');

const start = html.indexOf('    const A33_CHECKLIST_STORAGE_KEY = "arcano33_lotes";');
const end = html.indexOf('    function a33ChecklistNumber(value)', start);
assert.ok(start >= 0 && end > start, 'No se pudo aislar el cálculo de Producción');
const elements = new Map();
function element(id, value='') {
  const item = {
    id, value, hidden:true, textContent:'', children:[], attributes:new Map(),
    append(...children){ this.children.push(...children); },
    appendChild(child){ this.children.push(child); return child; },
    setAttribute(name, val){ this.attributes.set(name, String(val)); },
    focus(){}
  };
  elements.set(id, item);
  return item;
}
element('a33-produccion-volumen', '1500');
element('a33-produccion-preview');
element('a33-produccion-preview-grid');
element('a33-produccion-error');
element('a33-modal-produccion').hidden = false;
element('btn-produccion');
const document = {
  getElementById(id){ return elements.get(id) || null; },
  createElement(){ return { className:'', textContent:'', children:[], append(...children){ this.children.push(...children); } }; }
};
const stored = new Map();
const localStorage = {
  getItem(key){ return stored.has(key) ? stored.get(key) : null; },
  setItem(key, value){ stored.set(key, String(value)); }
};
const windowObj = { localStorage, A33Storage:null };
const code = html.slice(start, end) + '\n;globalThis.__calculate=a33ProductionCalculation;globalThis.__save=a33SaveProductionChecklist;';
const context = vm.createContext({
  console, Date, Math, Number, String, Object, Array, Set, Map, JSON, Intl,
  document, window:windowObj, localStorage,
  hoyLocalISO:()=> '2026-10-01',
  a33ChecklistEmptyState:()=>({ vino:false, vodka:false, jugo:false, sirope:false, agua:false }),
  a33OpenChecklist:()=>{}, a33RenderChecklistHistory:()=>{}
});
vm.runInContext(code, context, { filename:'calculadora-produccion-1000ml.js' });

const result = context.__calculate(1500);
assert.strictEqual(result.totalMl, 1500);
assert.strictEqual(result.ingredients.vino, 675);
assert.strictEqual(result.ingredients.vodka, 150);
assert.strictEqual(result.ingredients.jugo, 225);
assert.strictEqual(result.ingredients.sirope, 225);
assert.strictEqual(result.ingredients.agua, 225);
assert.strictEqual(context.__calculate(0), null);
assert.strictEqual(context.__calculate(-10), null);
assert.strictEqual(context.__save(), true, 'Guardar debe completar el registro');
const saved = JSON.parse(stored.get('arcano33_produccion_checklists'));
assert.strictEqual(saved.length, 1);
assert.strictEqual(saved[0].fecha, '2026-10-01');
assert.strictEqual(saved[0].volTotal, 1500);
assert.strictEqual(saved[0].volVino, 675);
assert.strictEqual(saved[0].volVodka, 150);
assert.strictEqual(saved[0].volJugo, 225);
assert.strictEqual(saved[0].volSirope, 225);
assert.strictEqual(saved[0].volAgua, 225);
assert.strictEqual(stored.has('arcano33_lotes'), false, 'Guardar no debe escribir en lotes oficiales');

console.log('PASS a33-calculadora-produccion-1000ml-etapa1: fórmula, UI, aislamiento y caché cubiertos');
