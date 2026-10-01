'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, '../pos/app.js'), 'utf8');
function select(){
  return {dataset:{}, options:[], value:'', appendChild(o){this.options.push(o);},
    set innerHTML(v){this.options = v.includes('<option') ? [{value:'', textContent:'— Seleccionar evento —'}] : [];}};
}
const group = select();
const sale = select();
const input = {style:{}, value:''};
const nodes = {'event-group-select':group, 'sale-event':sale, 'event-group-new':input, 'event-status':{}};
const events = [{id:1,name:'Viernes',groupName:'2026'}, {id:2,name:'Sábado',groupName:'2026',closedAt:'2026-09-30'}, {id:3,name:'Anterior',groupName:'2025'}, {id:4,name:'Histórico',groupName:''}];
let current = 1;
let last = '2026';
let resetCount = 0;
const ctx = {
  console, document:{createElement:()=>({})}, $:id=>nodes[id.slice(1)],
  ensureGroupCatalogFromEventsPOS:()=>['2026','2025'], getHiddenGroups:()=>[],
  getLastGroupName:()=>last, setLastGroupName:v=>{last=v;},
  getAll:async()=>events, getMeta:async()=>current,
  setMeta:async(k,v)=>{assert.equal(k,'currentEventId');current=v;},
  resetOperationalStateOnEventSwitchPOS:async()=>{resetCount++;},
  refreshSaleStockLabel:async()=>{}, renderDay:async()=>{}, renderSummaryDailyCloseCardPOS:async()=>{},
  rememberGroup:v=>{last=v;}
};
vm.createContext(ctx);
const helper = source.slice(source.indexOf('function refreshGroupSelectFromEvents(evs)'),source.indexOf('async function refreshEventUI()'));
const refresh = source.slice(source.indexOf('async function refreshEventUI()'), source.indexOf('  if (cur && cur.closedAt) {',source.indexOf('async function refreshEventUI()'))) + '\n}';
vm.runInContext(helper + refresh,ctx);
const changeStart = source.indexOf("groupSelect.addEventListener('change', async()=>{");
const change = source.slice(changeStart + "groupSelect.addEventListener('change', async()=>{".length,source.indexOf("      const newInput = $('#event-group-new');",changeStart));
vm.runInContext('async function changeGroup(){const groupSelect = $("#event-group-select");'+change+'}',ctx);
(async()=>{
  await ctx.refreshEventUI();
  assert.deepEqual(sale.options.map(o=>String(o.value)),['','1','2']);
  assert.equal(sale.value,'1');
  assert.ok(sale.options[2].textContent.includes('(cerrado)'));
  group.value='2025';
  await ctx.changeGroup();
  assert.equal(current,null);
  assert.equal(sale.value,'');
  assert.deepEqual(sale.options.map(o=>String(o.value)),['','3']);
  assert.equal(resetCount,1);
  await ctx.refreshEventUI();
  assert.equal(group.value,'2025');
  current=3;
  await ctx.refreshEventUI();
  assert.equal(sale.value,'3');
  group.value='';
  await ctx.changeGroup();
  await ctx.refreshEventUI();
  assert.equal(current,null);
  assert.equal(last,'');
  assert.equal(group.value,'');
  assert.deepEqual(sale.options.map(o=>String(o.value)),['']);
  group.value='__new__';
  await ctx.changeGroup();
  assert.equal(group.value,'__new__');
  assert.deepEqual(sale.options.map(o=>String(o.value)),['']);
  assert.equal(events.length,4);
  console.log('PASS: filtro por maestro, selección explícita, maestro vacío, crear grupo e historial conservado.');
})().catch(e=>{console.error(e);process.exitCode=1;});
