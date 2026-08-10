'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pos/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'pos/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pos/styles.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'pos/sw.js'), 'utf8');

function between(source, startToken, endToken){
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `No se encontró ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `No se encontró cierre para ${startToken}`);
  return source.slice(start, end);
}

// 1) Resumen existe una sola vez y está antes de FX/Inicio/Movimientos/Cierre.
assert.strictEqual((html.match(/id="cashv2-summary-card"/g)||[]).length, 1, 'Resumen superior duplicado');
assert.strictEqual((html.match(/id="cashv2-sum-initial-nio"/g)||[]).length, 1, 'Resumen físico NIO duplicado');
const pSummary = html.indexOf('id="cashv2-summary-card"');
for (const id of ['cashv2-fx-card','cashv2-initial-card','cashv2-movements-card','cashv2-final-card']) {
  assert.ok(pSummary < html.indexOf(`id="${id}"`), `Resumen no quedó arriba de ${id}`);
}
const finalChunk = between(html, 'id="cashv2-final-card"', '</section>');
assert.ok(!finalChunk.includes('cashv2-sum-initial-nio'), 'Quedó copia del Resumen dentro de Cierre');

// 2) Datos bancarios visibles, con líneas de comisión por snapshot.
for (const token of ['cashv2-sum-transfer-nio','cashv2-sum-card-nio','cashv2-sum-card-commission-total','cashv2-sum-card-commission-lines']) {
  assert.ok(html.includes(token), `Falta ${token}`);
}
assert.ok(html.includes('Tarjeta, Transferencia y Comisión son informativos; no alteran Caja física.'));
assert.ok(app.includes('const cardCommissions = collectSaleCardCommissionsPOS(filtered);'), 'Comisión no consume snapshots congelados');
assert.ok(app.includes('commissionLabelSnapshot'), 'No se conserva etiqueta snapshot');
assert.ok(app.includes('cashV2ApplyBankingSummaryPOS(bankSummary)'), 'Resumen bancario no se integra al render de Efectivo');
assert.ok(!/cashV2ComputeCloseNumbers[\s\S]{0,1200}(?:transferencia|tarjeta|commission)/i.test(between(app,'function cashV2ComputeCloseNumbers(rec, opts)','function cashV2SetDiffPill')), 'Tarjeta/Transferencia/Comisión contaminan cálculo de Caja');

// 3) Cálculo de cierre físico mantiene fórmula original.
const closeBlock = between(app, 'function cashV2ComputeCloseNumbers(rec, opts)', 'function cashV2SetDiffPill');
assert.ok(closeBlock.includes('iN + sN.entries + sN.collections - sN.out + salesC + sN.adjust'));
assert.ok(closeBlock.includes('iU + sU.entries + sU.collections - sU.out + salesUSD + sU.adjust'));
assert.ok(closeBlock.includes('fN - eN'));
assert.ok(closeBlock.includes('fU - eU'));

// 4) Multibanco/tasas: helper de agrupación usa etiqueta exacta y no banco actual.
const round2 = n => Math.round((Number(n)+Number.EPSILON)*100)/100;
const cashV2Round2Money = round2;
const safeYMD = v => String(v||'').slice(0,10);
const normalizePaymentMethodPOS = p => String(p||'').toLowerCase();
const isCourtesySalePOS = s => !!(s && (s.courtesy || s.isCourtesy));
const collectSaleCardCommissionsPOS = sales => {
  const m = new Map(); let total=0, undeterminedCount=0;
  for (const s of sales){
    if (!s || s.payment !== 'tarjeta' || isCourtesySalePOS(s)) continue;
    if (s.commissionAmountSnapshot == null || !s.commissionLabelSnapshot){ undeterminedCount++; continue; }
    const value=round2(s.commissionAmountSnapshot); total=round2(total+value);
    const cur=m.get(s.commissionLabelSnapshot)||{label:s.commissionLabelSnapshot,total:0,count:0};
    cur.total=round2(cur.total+value); cur.count++; m.set(cur.label,cur);
  }
  return {total,byLabel:Array.from(m.values()).sort((a,b)=>a.label.localeCompare(b.label)),undeterminedCount};
};
let dbSales = [
  {eventId:1,date:'2026-08-10',payment:'efectivo',total:500},
  {eventId:1,date:'2026-08-10',payment:'transferencia',total:800},
  {eventId:1,date:'2026-08-10',payment:'tarjeta',total:3190,commissionAmountSnapshot:223.30,commissionLabelSnapshot:'Comisión LAFISE 7%'},
  {eventId:1,date:'2026-08-10',payment:'tarjeta',total:900,commissionAmountSnapshot:45,commissionLabelSnapshot:'Comisión BAC 5%'},
  {eventId:1,date:'2026-08-09',payment:'tarjeta',total:999,commissionAmountSnapshot:99,commissionLabelSnapshot:'Comisión vieja 10%'},
  {eventId:2,date:'2026-08-10',payment:'tarjeta',total:777,commissionAmountSnapshot:77.7,commissionLabelSnapshot:'Comisión otro evento 10%'}
];
const cashV2GetSalesByEventPOS = async eid => dbSales.filter(s=>String(s.eventId)===String(eid));
const sandbox = {Number,String,Object,Math,Array,Map,Date,safeYMD,normalizePaymentMethodPOS,isCourtesySalePOS,collectSaleCardCommissionsPOS,cashV2Round2Money,cashV2GetSalesByEventPOS};
vm.createContext(sandbox);
const helper = between(app, 'async function cashV2ComputeBankingSummaryPOS(eventId, dayKey)', 'function cashV2ApplyBankingSummaryPOS(summary)');
vm.runInContext(`${helper}\nthis.fn=cashV2ComputeBankingSummaryPOS;`, sandbox);
(async()=>{
  const s = await sandbox.fn('1','2026-08-10');
  assert.strictEqual(s.transfer,800);
  assert.strictEqual(s.card,4090);
  assert.strictEqual(s.commissionTotal,268.30);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.commissions)),[
    {label:'Comisión BAC 5%',total:45,count:1},
    {label:'Comisión LAFISE 7%',total:223.30,count:1}
  ]);

  // 5) Responsive/no scroll general + montos en una línea.
  assert.ok(css.includes('.cashv2-summary-grid{display:grid'));
  assert.ok(css.includes('@media (max-width:680px)'));
  assert.ok(css.includes('.cashv2-summary-table td.sub{white-space:nowrap'));
  assert.ok(!css.includes('.cashv2-summary-card{overflow-x:auto'));

  // 6) PWA cache bump coherente.
  assert.ok(html.includes("-pos-r'+rev+'-m55"));
  assert.ok(html.includes('styles.css?v=4.20.97&r=25'));
  assert.ok(html.includes('manifest.webmanifest?v=4.20.97&r=27'));
  assert.ok(fs.readFileSync(path.join(root, 'pos/manifest.webmanifest'), 'utf8').includes('./index.html?v=4.20.97&r=34'));
  assert.ok(html.includes('app.js?v=4.20.97&r=51'));
  assert.ok(sw.includes("const MODULE_CACHE_REV = '55';"));
  assert.ok(sw.includes("'./styles.css?v=4.20.97&r=25'"));
  assert.ok(sw.includes("'./manifest.webmanifest?v=4.20.97&r=27'"));
  assert.ok(sw.includes("'./app.js?v=4.20.97&r=51'"));

  console.log('SMOKE OK — Suite A33 — POS Efectivo — Etapa 3/5 — Resumen superior y comisiones');
})().catch(err=>{ console.error(err); process.exit(1); });
