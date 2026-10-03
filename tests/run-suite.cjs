'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const catalogPath = path.join(__dirname, 'catalogo.json');

function classify(result) {
  if (result.timedOut) return 'INCONCLUSA';
  if (result.code === 0) return 'APROBADA';
  if (/listen (?:EPERM|EACCES)|Executable doesn't exist|Cannot find module ['"](?:playwright|.*\/playwright)['"]|browserType\.launch:.*(?:Operation not permitted|Permission denied)/i.test(result.output)) return 'BLOQUEADA_ENTORNO';
  return 'FALLIDA';
}

function runProcess(args, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false, truncated = false, hardTimer;
    const append = chunk => {
      const text = chunk.toString();
      if (output.length + text.length > 131072) truncated = true;
      if (output.length < 131072) output += text.slice(0, 131072 - output.length);
    };
    const stop = signal => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch (_) {}
    };
    const timer = setTimeout(() => { timedOut = true; stop('SIGTERM'); hardTimer = setTimeout(() => stop('SIGKILL'), 500); }, timeoutMs);
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', error => append(String(error)));
    child.on('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(hardTimer);
      const result = { code, signal, timedOut, output, truncated };
      resolve({ ...result, status: classify(result) });
    });
  });
}

function inventory(catalog) {
  const actual = fs.readdirSync(__dirname).filter(name => name.endsWith('.smoke.cjs')).sort();
  const names = catalog.tests.map(row => row.file);
  if (new Set(names).size !== names.length || actual.some(name => !names.includes(name)) || names.some(name => !actual.includes(name))) throw new Error('El catálogo no coincide con los archivos smoke: revisa altas, ausencias o duplicados.');
  for (const row of catalog.tests) {
    if (!['vigente', 'historica', 'por_verificar', 'alias'].includes(row.classification)) throw new Error('Clasificación inválida: ' + row.file);
    if ((row.classification === 'alias') !== !!row.aliasOf) throw new Error('Clasificación de alias inconsistente: ' + row.file);
    if (row.aliasOf && (!names.includes(row.aliasOf) || catalog.tests.find(t => t.file === row.aliasOf).aliasOf)) throw new Error('Alias inválido: ' + row.file);
  }
  return catalog.tests;
}

async function main(argv) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const rows = inventory(catalog);
  let list = false, browser = false, historical = false, timeout = 20000, report, group;
  const selected = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') list = true;
    else if (arg === '--browser') browser = true;
    else if (arg === '--historical') historical = true;
    else if (arg === '--group') { group = argv[++i]; if (!['funcional','publicacion'].includes(group)) throw new Error('Grupo desconocido: funcional o publicacion.'); }
    else if (arg === '--timeout-ms') timeout = Number(argv[++i]);
    else if (arg === '--report') report = argv[++i];
    else if (arg === '--test') {
      const file = argv[++i];
      const row = rows.find(t => t.file === file);
      if (!row) throw new Error('Prueba desconocida. Usa --list.');
      selected.add(row.aliasOf || row.file);
    } else throw new Error('Opción desconocida: ' + arg);
  }
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 300000) throw new Error('Timeout permitido: 100–300000 ms.');
  if (list) { for (const row of rows) console.log(`${row.classification}\t${row.group || 'funcional'}\t${row.mode}\t${row.file}${row.aliasOf ? ' → ' + row.aliasOf : ''}`); return; }
  if (report) {
    report = path.resolve(report);
    if (fs.existsSync(report)) throw new Error('El informe ya existe: se conserva sin sobrescribir.');
    if (!fs.existsSync(path.dirname(report))) throw new Error('La carpeta del informe debe existir.');
  }
  const results = [], excludedHistorical = [];
  for (const row of rows) {
    if (row.aliasOf) continue;
    if (group && (row.group || 'funcional') !== group) continue;
    if (selected.size && !selected.has(row.file)) continue;
    if (!selected.size && row.classification === 'historica' && !historical) { excludedHistorical.push(row.file); continue; }
    if (row.mode === 'browser' && !browser) {
      results.push({ ...row, status: 'NO_EJECUTADA', reason: 'Requiere --browser; no se comprobó el entorno.' });
      console.log(`NO_EJECUTADA ${row.file} (requiere --browser)`); continue;
    }
    const start = Date.now();
    const result = await runProcess([path.join(__dirname, row.file)], timeout);
    results.push({ ...row, ...result, elapsedMs: Date.now() - start });
    console.log(`${result.status} ${row.file} (${Date.now() - start} ms)`);
    if (result.status !== 'APROBADA') console.log(result.output.match(/(?:AssertionError[^\n]*|(?:ReferenceError|TypeError|Error):[^\n]*)/)?.[0] || result.output.slice(-500));
  }
  const counts = results.reduce((out, row) => { out[row.status] = (out[row.status] || 0) + 1; return out; }, {});
  const summary = { startedFrom: 'tests/catalogo.json', generatedAt: new Date().toISOString(), counts, excludedHistorical, aliases: rows.filter(row => row.aliasOf).map(row => ({file:row.file, aliasOf:row.aliasOf})), results };
  console.log('RESUMEN ' + JSON.stringify(counts));
  console.log('Históricas excluidas: ' + excludedHistorical.length + '; aliases sin duplicar: ' + rows.filter(row => row.aliasOf).length);
  if (report) fs.writeFileSync(report, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  process.exitCode = results.some(row => row.status === 'FALLIDA') ? 1 : results.some(row => ['INCONCLUSA', 'BLOQUEADA_ENTORNO', 'NO_EJECUTADA'].includes(row.status)) ? 2 : 0;
}
module.exports = { classify, runProcess, inventory };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });
