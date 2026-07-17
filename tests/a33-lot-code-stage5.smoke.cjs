"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const lotCode = require(path.join(root, "assets/js/a33-lot-code.js"));
const NEW_CODE = "A33KIS5786-0xx1";
const HIST_CODE = "A330xX119TEV5786";

assert.strictEqual(lotCode.display(NEW_CODE), NEW_CODE);
assert.strictEqual(lotCode.display("A33KIS5786-0XX1"), NEW_CODE);
assert.strictEqual(lotCode.display(HIST_CODE), HIST_CODE, "Los históricos se conservan literalmente");
assert.strictEqual(lotCode.identityKey("A33KIS5786-0XX1"), lotCode.identityKey(NEW_CODE));
assert.ok(lotCode.searchTerms(NEW_CODE).includes("KIS"));
assert.ok(lotCode.searchTerms(NEW_CODE).includes("5786"));
assert.ok(lotCode.searchTerms(NEW_CODE).includes("0001"));
assert.deepStrictEqual(lotCode.excelTextCell(NEW_CODE), { t:"s", v:NEW_CODE, z:"@" });
assert.strictEqual(JSON.parse(JSON.stringify({ codigoLote:NEW_CODE })).codigoLote, NEW_CODE);

const config = fs.readFileSync(path.join(root, "configuracion/script.js"), "utf8");
const configHtml = fs.readFileSync(path.join(root, "configuracion/index.html"), "utf8");
assert.ok(config.includes("lotCodeContract"), "JSON debe declarar preservación literal del lote");
assert.ok(config.includes("backupLotIdentityKey"), "Importación parcial debe deduplicar X/x sin reescribir");
assert.ok(config.includes("lotCodeLiteral:true"), "Validación JSON debe aceptar formatos históricos y nuevos");
assert.ok(configHtml.includes("a33-lot-code.js?v=4.20.95&amp;r=6"));
assert.ok(configHtml.includes("Configuración, Catálogos y Lotes"));

const lotes = fs.readFileSync(path.join(root, "lotes/script.js"), "utf8");
assert.ok(lotes.includes("batchCodeSearchTerms"));
assert.ok(lotes.includes("batchCodeExcelText"));
assert.ok(lotes.includes("...batchCodeSearchTerms(visibleCode)"));
assert.ok(lotes.includes("...batchCodeSearchTerms(r.codigo || r.batchCode || '')"));
assert.ok(lotes.includes("index === 1 ? 24"), "Excel de Lotes debe reservar ancho suficiente");

const pos = fs.readFileSync(path.join(root, "pos/app.js"), "utf8");
assert.ok(pos.includes("lotCodeExcelCellPOS"));
assert.ok(pos.includes("'codigo_lote'"));
assert.ok(pos.includes("'Código de lote origen'"));
assert.ok(pos.includes("lotCodeExcelCellPOS(getSaleLotCodePOS(s))"));

const analytics = fs.readFileSync(path.join(root, "analitica/script.js"), "utf8");
const analyticsHtml = fs.readFileSync(path.join(root, "analitica/index.html"), "utf8");
assert.ok(analytics.includes("saleLotCodesAnalytics"));
assert.ok(analytics.includes("analyticsLotExcelCell"));
assert.ok(analyticsHtml.includes("<th>Código de lote</th>"));
assert.ok(analyticsHtml.includes("a33-lot-code.js?v=4.20.95&r=6"));

const center = fs.readFileSync(path.join(root, "centro-mando/app.js"), "utf8");
const centerHtml = fs.readFileSync(path.join(root, "centro-mando/index.html"), "utf8");
assert.ok(center.includes("__cmdLatestLotForEvent"));
assert.ok(center.includes("mkSec('lote', 'Último lote'"));
assert.ok(centerHtml.includes("a33-lot-code.js?v=4.20.95&r=6"));

function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
function makeStorage(seed){
  const data = Object.assign({}, seed || {});
  return {
    data,
    getItem(key){ return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value){ data[key] = String(value); },
    removeItem(key){ delete data[key]; },
    getJSON(key, fallback){ try{ const raw=this.getItem(key); return raw == null ? fallback : JSON.parse(raw); }catch(_){ return fallback; } },
    setJSON(key, value){ this.setItem(key, JSON.stringify(value)); return true; }
  };
}
function makeDb(){
  const rootData = {};
  const parts = (p) => String(p || "").split("/").filter(Boolean);
  const read = (p) => parts(p).reduce((cur, key) => cur && cur[key], rootData);
  const write = (p, value) => {
    const keys = parts(p);
    let cur = rootData;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) cur[key] = clone(value);
      else cur = cur[key] || (cur[key] = {});
    });
  };
  const remove = (p) => {
    const keys=parts(p); let cur=rootData;
    for(let i=0;i<keys.length-1;i++){ cur=cur && cur[keys[i]]; if(!cur) return; }
    if(cur) delete cur[keys[keys.length-1]];
  };
  const ref = (p) => ({
    once: async () => ({ val: () => clone(read(p)) }),
    set: async (value) => write(p, value),
    remove: async () => remove(p),
    child: (key) => ref(String(p).replace(/\/$/, "") + "/" + key)
  });
  return { rootData, ref };
}
function loadCloud(storage){
  const source = fs.readFileSync(path.join(root, "assets/js/a33-cloud-sync.js"), "utf8");
  const settings = { enabled:true, configured:true, workspaceId:"arcano33", deviceId:"test-device" };
  const context = {
    console, Date, JSON, Object, Array, Map, Set, Promise, Math, String, Number,
    navigator:{ onLine:true },
    localStorage:storage,
    A33Storage:storage,
    A33LotCode:lotCode,
    A33FirebaseSettings:{
      read:() => clone(settings),
      save:() => ({ ok:true }),
      hasMinimumConfig:() => true,
      normalizeWorkspaceId:(v) => String(v || "arcano33"),
      ensureDeviceId:() => "test-device"
    },
    addEventListener:()=>{},
    dispatchEvent:()=>{},
    CustomEvent:function(){},
    globalThis:null
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename:"a33-cloud-sync.js" });
  return { api:context.A33CloudSync, settings };
}
function summary(){
  return { at:new Date().toISOString(), uploaded:0, downloaded:0, conflicts:0, errors:0, skipped:0, configUploaded:0, configDownloaded:0, catalogUploaded:0, catalogDownloaded:0, lotsUploaded:0, lotsDownloaded:0, warnings:[], details:[] };
}

(async () => {
  const db = makeDb();
  const storage1 = makeStorage({ arcano33_lotes:JSON.stringify([
    { codigo:NEW_CODE, consecutivoNumerico:1, fecha:"2026-07-17" },
    { codigo:HIST_CODE, consecutivoNumerico:1, fecha:"2025-12-19" }
  ]) });
  const session1 = loadCloud(storage1);
  const up = summary();
  await session1.api.syncLots(db, session1.settings, up);
  assert.strictEqual(up.lotsUploaded, 2);
  const remoteLots = Object.values(db.rootData.workspaces.arcano33.lotes);
  assert.strictEqual(remoteLots.length, 2);
  assert.ok(remoteLots.some((r) => r.codigo === NEW_CODE));
  assert.ok(remoteLots.some((r) => r.codigo === HIST_CODE));
  assert.strictEqual(remoteLots.find((r) => r.codigo === NEW_CODE).consecutivoNumerico, 1, "El consecutivo numérico sigue separado");

  const storage2 = makeStorage({ arcano33_lotes:"[]" });
  const session2 = loadCloud(storage2);
  const down = summary();
  await session2.api.syncLots(db, session2.settings, down);
  const downloaded = JSON.parse(storage2.getItem("arcano33_lotes"));
  assert.strictEqual(down.lotsDownloaded, 2);
  assert.strictEqual(downloaded.length, 2);
  assert.ok(downloaded.some((r) => r.codigo === NEW_CODE));
  assert.ok(downloaded.some((r) => r.codigo === HIST_CODE));

  storage2.setItem("arcano33_lotes", JSON.stringify([
    { codigo:"A33KIS5786-0XX1", consecutivoNumerico:1, fecha:"2026-07-17" },
    { codigo:NEW_CODE, consecutivoNumerico:1, fecha:"2026-07-17" },
    downloaded.find((r) => r.codigo === HIST_CODE)
  ]));
  const dedupe = summary();
  await session2.api.syncLots(db, session2.settings, dedupe);
  const afterDedupe = JSON.parse(storage2.getItem("arcano33_lotes"));
  assert.strictEqual(afterDedupe.length, 2, "X/x no debe duplicar el lote");
  assert.ok(afterDedupe.some((r) => r.codigo === NEW_CODE), "Se conserva el código remoto exacto con x");
  assert.strictEqual(Object.keys(db.rootData.workspaces.arcano33.lotes).length, 2, "Firebase no crea documentos paralelos");

  console.log("A33 lot code stage 5 integration smoke: OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
