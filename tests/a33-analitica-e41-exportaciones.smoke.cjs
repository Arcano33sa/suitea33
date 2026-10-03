'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const XLSX = require(path.join(root, 'pos/vendor/xlsx.full.min.js'));
const source = fs.readFileSync(path.join(root, 'analitica/script.js'), 'utf8');
const sales = [
  { date:'2026-10-02', eventId:1, productId:'p1', productName:'Producto', qty:2, unitPrice:100, total:180, lineCost:60, loteCodigo:'001-A' },
  { date:'2026-10-02', eventId:1, productId:'p1', productName:'Producto', qty:1, unitPrice:100, total:0, lineCost:30, courtesy:true, loteCodigo:'001-A' },
  { date:'2026-10-02', eventId:1, productId:'p1', productName:'Producto', qty:-1, unitPrice:100, total:-100, lineCost:-30, isReturn:true, loteCodigo:'001-A' }
];
const original = JSON.stringify(sales);
const handlers = new Map();
const downloads = [];
const alerts = [];
const notices = [];
const ids = ['btn-export-resumen', 'btn-export-eventos', 'btn-export-presentaciones'];
const sandbox = {
  console,
  MutationObserver: class { observe(){} },
  document: {
    addEventListener(){},
    getElementById(id){
      return ids.includes(id) ? { addEventListener(event, handler){
        assert.strictEqual(event, 'click'); handlers.set(id, handler);
      }} : null;
    }
  },
  window: { addEventListener(){}, A33Notice: {
    alert(message){ alerts.push(message); },
    show(message, type){ notices.push({message, type}); }
  }},
  XLSX: { ...XLSX, writeFile(workbook, filename){
    // Serialize and read the real XLSX binary in memory; no user files or storage.
    const bytes = XLSX.write(workbook, { type:'buffer', bookType:'xlsx' });
    downloads.push({ filename, workbook:XLSX.read(bytes, { type:'buffer' }) });
  }},
  fixtureSales:sales
};
vm.createContext(sandbox);
const hook = `
  this.seedExports = function(rows){
    products = [];
    lastFilteredSales = rows;
    lastEventStats = buildEventStats(rows, [{id:1,name:'Evento de prueba'}]);
    lastPresStats = buildPresentationStats(rows);
  };
  setupExportButtons();
`;
assert.ok(source.trimEnd().endsWith('})();'));
vm.runInContext(source.replace(/\}\)\(\);\s*$/, hook + '\n})();'), sandbox);
sandbox.seedExports(sales);
assert.strictEqual(handlers.size, 3);
for (const id of ids) handlers.get(id)();
assert.deepStrictEqual(downloads.map(d => d.filename), [
  'analitica_resumen.xlsx', 'analitica_eventos.xlsx', 'analitica_productos.xlsx'
]);
const rowsOf = (index, sheet) => XLSX.utils.sheet_to_json(downloads[index].workbook.Sheets[sheet], {header:1});
const summary = rowsOf(0, 'Resumen');
for (const [label, expected] of [['Ventas totales',80], ['Costo total',60], ['Utilidad total',20], ['Costo real de cortesías',30]]) {
  assert.strictEqual(Number(summary.find(row => row[1] === label)[2]), expected, label);
}
const events = rowsOf(1, 'Eventos');
assert.strictEqual(events[1][0], 'Evento de prueba');
assert.strictEqual(events[1][1], '001-A');
assert.strictEqual(Number(events[1][3]), 80);
assert.strictEqual(Number(events[1][4]), 60);
assert.strictEqual(Number(events[1][5]), 20);
const products = rowsOf(2, 'Productos');
assert.strictEqual(products[1][1], '001-A');
assert.strictEqual(products[1][2], 'p1');
assert.strictEqual(products[1][4], 2);
assert.strictEqual(Number(products[1][9]), 80);
assert.strictEqual(Number(products[1][13]), 30);
assert.strictEqual(alerts.length, 0);
assert.strictEqual(notices.filter(n => n.type === 'success').length, 3);

// Empty datasets retain the existing warning and do not create files.
sandbox.seedExports([]);
for (const id of ids) handlers.get(id)();
assert.strictEqual(downloads.length, 3);
assert.strictEqual(alerts.length, 3);

// Missing CDN library retains the controlled warning (offline support is E4.2).
sandbox.seedExports(sales);
delete sandbox.XLSX;
for (const id of ids) handlers.get(id)();
assert.strictEqual(downloads.length, 3);
assert.strictEqual(alerts.filter(a => a.includes('XLSX no cargada')).length, 3);
assert.strictEqual(JSON.stringify(sales), original);
console.log('APROBADA E4.1: tres botones, XLSX real en memoria, importes, lotes, datos vacíos y librería ausente; datos intactos.');
