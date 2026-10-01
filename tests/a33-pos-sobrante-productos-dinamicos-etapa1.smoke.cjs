const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const posPath = path.join(root, 'pos', 'app.js');
const lotesPath = path.join(root, 'lotes', 'script.js');
const pos = fs.readFileSync(posPath, 'utf8');
const lotes = fs.readFileSync(lotesPath, 'utf8');

function extractFunction(source, name){
  const marker = `function ${name}(`;
  let start = source.indexOf(marker);
  assert(start >= 0, `No se encontró ${name}`);
  if (source.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const brace = source.indexOf('){', start) + 1;
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++){
    const ch = source[i], next = source[i+1];
    if (lineComment){ if (ch === '\n') lineComment = false; continue; }
    if (blockComment){ if (ch === '*' && next === '/'){ blockComment = false; i++; } continue; }
    if (quote){
      if (escaped){ escaped = false; continue; }
      if (ch === '\\'){ escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/'){ lineComment = true; i++; continue; }
    if (ch === '/' && next === '*'){ blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`'){ quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}'){
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Función incompleta: ${name}`);
}

const ctx = {
  console, Object, Array, String, Number, Map, Set, Math, Date,
  catalogProductStableIdPOS:p=>p.productId,
  catalogProductInternalIdPOS:p=>p.id || null,
  catalogProductSnapshotNamePOS:p=>p.name,
  lotesPOSContractRowsPOS:p=>p.productosProducidos || [],
};
vm.createContext(ctx);
for (const name of ['productIdentityNormPOS','productIdentityNameKeyPOS','buildProductIdentityIndexPOS','collectProductIdentityCandidatesPOS','resolveCatalogProductIdentityPOS','sobranteUsageSnapshotPOS','sobranteQtyPOS','sobranteSnapshotQtyPOS','sobranteProductRowsPOS','sobranteRowIdentityPOS','buildSobranteTransferItemsPOS','subtractSobranteFromParentSnapshotPOS','getSobranteInputsPOS','renderSobranteProductsPOS']){
  vm.runInContext(extractFunction(pos,name),ctx);
}
const products=[{productId:'c',name:'Catrina nueva',Letra:'C',active:false},{productId:'p',name:'Pulso',Letra:'P'},{productId:'other',name:'Otro activo',Letra:'X'}];
const parent={id:'a',eventUsage:{10:{remainingByProductId:{c:3,p:2,deleted:1},availabilityProducts:[
  {productId:'c',nombreSnapshot:'Catrina histórica',Letra:'C',cantidadDisponible:3},
  {productId:'p',nombreSnapshot:'Pulso',Letra:'P',cantidadDisponible:2},
  {productId:'deleted',nombreSnapshot:'Catrina eliminada',Letra:'C',cantidadDisponible:1}
]}}};
const build=(quantities)=>ctx.buildSobranteTransferItemsPOS(parent,10,{},products,quantities);
let transfer=build({'PID:c':2,'PID:p':0,'PID:deleted':1});
assert(transfer.ok);
assert.strictEqual(transfer.items.length,2);
assert.strictEqual(transfer.items[0].nombreSnapshot,'Catrina histórica');
assert.strictEqual(transfer.items[1].productId,'deleted','Un producto histórico se reasignó por letra');
assert(!transfer.items.some(r=>r.productId==='other'));
assert(!build({'PID:c':4,'PID:p':0,'PID:deleted':0}).ok,'Permitió exceder saldo');
assert(!build({'PID:c':-1,'PID:p':0,'PID:deleted':0}).ok);
assert(!build({'PID:c':1.5,'PID:p':0,'PID:deleted':0}).ok);
assert(!build({'PID:c':0,'PID:p':0,'PID:deleted':0}).ok);
assert(!build({'PID:c':1,'PID:p':0}).ok,'Producto nuevo se transfirió automáticamente');
ctx.subtractSobranteFromParentSnapshotPOS(parent,10,transfer.items);
assert.strictEqual(parent.eventUsage[10].remainingByProductId.c,1);
assert.strictEqual(parent.eventUsage[10].remainingByProductId.deleted,0);
const legacy={pulso:'2',media:'0'};
assert.strictEqual(ctx.buildSobranteTransferItemsPOS(legacy,10,{},products,{'PID:p':1}).items[0].cantidad,1);
// Smoke de interfaz con DOM aislado, sin tocar almacenamiento real.
function element(){return {dataset:{},value:'',children:[],append(...nodes){this.children.push(...nodes)},appendChild(node){this.children.push(node)},replaceChildren(){this.children=[]},querySelectorAll(){return this.children.flatMap(c=>c.children || []).filter(n=>n.dataset.sobranteKey)}};}
const grid=element(), select={value:'a'}, button={};
ctx.document={getElementById:id=>({'sobrante-products':grid,'sobrante-lote-select':select,'btn-sobrante-create':button}[id]),createElement:element};
ctx.syncLotsUsageForEvent=async()=>{};
ctx.getAll=async()=>products;
const lots=[parent,{id:'b',productosProducidos:[{productId:'p',Letra:'P',cantidadDisponible:7}]}];
ctx.readLotesLS_POS=()=>lots;
vm.runInContext('let sobranteRenderSequencePOS = 0;',ctx);
(async()=>{
  await ctx.renderSobranteProductsPOS(10);
  assert.strictEqual(grid.children.length,3);
  assert.strictEqual(grid.children[0].children[0].textContent,'Catrina histórica · C');
  assert.strictEqual(ctx.getSobranteInputsPOS()['PID:c'],1);
  select.value='b';
  assert.throws(()=>ctx.getSobranteInputsPOS());
  await ctx.renderSobranteProductsPOS(10);
  assert.strictEqual(grid.children.length,1);
  assert.strictEqual(ctx.getSobranteInputsPOS()['PID:p'],7,'No recalculó al cambiar de lote');
  grid.children[0].children[1].value='-1';
  assert.throws(()=>ctx.getSobranteInputsPOS());
  const html=fs.readFileSync(path.join(root,'pos/index.html'),'utf8');
  assert(html.includes('id="sobrante-products"'));
  assert(!html.includes('id="sobrante-p"'));
  assert(pos.includes('await renderSobranteProductsPOS(eventId)'));
  assert(pos.includes('buildSobranteTransferItemsPOS(parent, evId, qty, products, manualByKey)'));
  console.log('OK: sobrantes dinámicos E1, identidad histórica, límites, transferencia y cambio de lote');
})().catch(error=>{console.error(error);process.exitCode=1});
