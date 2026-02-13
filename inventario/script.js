const STORAGE_KEY_INVENTARIO = "arcano33_inventario";

const LIQUIDS = [
  { id: "vino",   nombre: "Vino" },
  { id: "vodka",  nombre: "Vodka" },
  { id: "jugo",   nombre: "Jugo" },
  { id: "sirope", nombre: "Sirope" },
  { id: "agua",   nombre: "Agua pura" },
];

const BOTTLES = [
  { id: "pulso", nombre: "Pulso 250 ml" },
  { id: "media", nombre: "Media 375 ml" },
  { id: "djeba", nombre: "Djeba 750 ml" },
  { id: "litro", nombre: "Litro 1000 ml" },
  { id: "galon", nombre: "Galón 3750 ml" },
];

const FINISHED = [
  { id: "pulso", nombre: "Pulso 250 ml (listo)" },
  { id: "media", nombre: "Media 375 ml (lista)" },
  { id: "djeba", nombre: "Djeba 750 ml (lista)" },
  { id: "litro", nombre: "Litro 1000 ml (lista)" },
  { id: "galon", nombre: "Galón 3750 ml (lista)" },
];

const CAPS_KEYS = [
  'gallon',
  'pulsoLitro',
  'djebaMedia',
  'vasos12oz',
];

const CAPS = [
  { id: 'gallon', nombre: 'Tapa Galón' },
  { id: 'pulsoLitro', nombre: 'Tapa Pulso/Litro' },
  { id: 'djebaMedia', nombre: 'Tapa Djeba/Media' },
  { id: 'vasos12oz', nombre: 'Vasos 12oz' },
];

function defaultCapsSection(){
  const out = {};
  CAPS_KEYS.forEach((k)=>{ out[k] = { stock: 0, min: 0 }; });
  return out;
}



function $(id) {
  return document.getElementById(id);
}

function defaultInventario() {
  const inv = {
    liquids: {},
    bottles: {},
    finished: {},
    caps: defaultCapsSection(),
    varios: [],
  };
  LIQUIDS.forEach((l) => {
    inv.liquids[l.id] = { stock: 0, max: 0 };
  });
  BOTTLES.forEach((b) => {
    inv.bottles[b.id] = { stock: 0 };
  });
  FINISHED.forEach((p) => {
    inv.finished[p.id] = { stock: 0 };
  });
  return inv;
}

function parseNumber(value) {
  const n = parseFloat(String(value).replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
}

// ------------------------------
// Integridad dura (Etapa 1)
// - No aceptar NaN/Infinity/strings raras al guardar.
// - Bloquear negativos donde no aplique.
// - Errores visibles (no silenciosos).
// ------------------------------

function safeAlert(msg){
  try{ alert(String(msg || 'Error')); }catch(_){ console.error(String(msg || 'Error')); }
}

// ------------------------------
// Anti-pisadas multi-módulo (Etapa 2)
// - Releer antes de guardar
// - Merge conservador por campo editado
// - Conflicto si otro módulo cambió lo mismo (rev/updatedAt)
// ------------------------------

let INV_BASE_SNAPSHOT = null;
let INV_BASE_REV = null;
let INV_BASE_UPDATED_AT = null;

function deepClone(obj){
  try{ return JSON.parse(JSON.stringify(obj ?? null)); }catch(_){ return obj; }
}

function readInventarioShared(){
  if (window.A33Storage && typeof A33Storage.sharedRead === 'function'){
    const r = A33Storage.sharedRead(STORAGE_KEY_INVENTARIO, defaultInventario(), 'local');
    const data = (r && r.data && typeof r.data === 'object') ? r.data : defaultInventario();
    const meta = (r && r.meta && typeof r.meta === 'object') ? r.meta : { rev: 0, updatedAt: null, writer: '' };
    normalizeInventarioInPlace(data);
    return { data, meta };
  }
  if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
    const data = A33Storage.sharedGet(STORAGE_KEY_INVENTARIO, defaultInventario(), 'local');
    const out = (data && typeof data === 'object') ? data : defaultInventario();
    normalizeInventarioInPlace(out);
    return { data: out, meta: { rev: 0, updatedAt: null, writer: '' } };
  }
  return { data: null, meta: { rev: 0, updatedAt: null, writer: '' } };
}

function readInventarioMetaRaw(){
  const mk = STORAGE_KEY_INVENTARIO + '__meta';
  try{
    const m = (window.A33Storage && typeof A33Storage.getJSON === 'function')
      ? A33Storage.getJSON(mk, null, 'local')
      : null;
    if (m && typeof m === 'object'){
      const rev = Number.isFinite(+m.rev) ? Math.trunc(+m.rev) : 0;
      const updatedAt = (typeof m.updatedAt === 'string') ? m.updatedAt : null;
      const writer = (typeof m.writer === 'string') ? m.writer : '';
      return { rev, updatedAt, writer };
    }
  }catch(_){ }
  return { rev: 0, updatedAt: null, writer: '' };
}

function writeInventarioMetaRaw(nextRev, writer){
  const mk = STORAGE_KEY_INVENTARIO + '__meta';
  const out = {
    rev: Number.isFinite(nextRev) ? Math.trunc(nextRev) : 0,
    updatedAt: (new Date()).toISOString(),
    writer: String(writer || 'inventario')
  };
  try{ A33Storage.setItem(mk, JSON.stringify(out), 'local'); }catch(_){ }
  try{
    if (window.A33Storage && A33Storage._sharedState) {
      A33Storage._sharedState[STORAGE_KEY_INVENTARIO] = { ...out, readAt: Date.now() };
    }
  }catch(_){ }
  return out;
}

function trackInventarioBase(inv, meta){
  try{
    normalizeInventarioInPlace(inv);
    INV_BASE_SNAPSHOT = deepClone(inv);
    INV_BASE_REV = (meta && Number.isFinite(+meta.rev)) ? Math.trunc(+meta.rev) : 0;
    INV_BASE_UPDATED_AT = (meta && meta.updatedAt) ? String(meta.updatedAt) : null;
  }catch(_){ }
}

function getField(inv, section, id, field){
  try{
    const sec = (inv && inv[section] && typeof inv[section] === 'object') ? inv[section] : null;
    const it = sec && sec[id] && typeof sec[id] === 'object' ? sec[id] : null;
    if (!it) return undefined;
    const v = it[field];
    return (typeof v === 'number') ? v : parseNumber(v);
  }catch(_){ return undefined; }
}

function signatureVarios(list){
  try{
    if (!Array.isArray(list)) return '[]';
    // Firma estable (asume líneas normalizadas)
    return JSON.stringify(list.map((x)=>({
      id: String((x && x.id) || ''),
      producto: String((x && x.producto) || ''),
      stock: Number.isFinite(+((x && x.stock))) ? Math.trunc(+x.stock) : 0,
      minimo: Number.isFinite(+((x && x.minimo))) ? Math.trunc(+x.minimo) : 0,
      createdAt: Number.isFinite(+((x && x.createdAt))) ? Math.trunc(+x.createdAt) : 0,
    })));
  }catch(_){ return '[]'; }
}

function getComparableForEdit(inv, e){
  try{
    if (e && e.section === 'varios' && e.op === 'replace'){
      return signatureVarios((inv && inv.varios) ? inv.varios : []);
    }
    return getField(inv, e.section, e.id, e.field);
  }catch(_){ return undefined; }
}

function collectEdits(base, local){
  const edits = [];
  const baseL = (base && base.liquids && typeof base.liquids === 'object') ? base.liquids : {};
  const localL = (local && local.liquids && typeof local.liquids === 'object') ? local.liquids : {};
  const idsL = new Set([...Object.keys(baseL), ...Object.keys(localL)]);
  idsL.forEach((id)=>{
    const bStock = getField(base, 'liquids', id, 'stock');
    const lStock = getField(local, 'liquids', id, 'stock');
    if (bStock !== lStock) edits.push({ section:'liquids', id, field:'stock', value:lStock });
    const bMax = getField(base, 'liquids', id, 'max');
    const lMax = getField(local, 'liquids', id, 'max');
    if (bMax !== lMax) edits.push({ section:'liquids', id, field:'max', value:lMax });
  });

  const baseB = (base && base.bottles && typeof base.bottles === 'object') ? base.bottles : {};
  const localB = (local && local.bottles && typeof local.bottles === 'object') ? local.bottles : {};
  const idsB = new Set([...Object.keys(baseB), ...Object.keys(localB)]);
  idsB.forEach((id)=>{
    const bStock = getField(base, 'bottles', id, 'stock');
    const lStock = getField(local, 'bottles', id, 'stock');
    if (bStock !== lStock) edits.push({ section:'bottles', id, field:'stock', value:lStock });
  });


  const baseC = (base && base.caps && typeof base.caps === 'object') ? base.caps : {};
  const localC = (local && local.caps && typeof local.caps === 'object') ? local.caps : {};
  const idsC = new Set([...Object.keys(baseC), ...Object.keys(localC)]);
  idsC.forEach((id)=>{
    const bStock = getField(base, 'caps', id, 'stock');
    const lStock = getField(local, 'caps', id, 'stock');
    if (bStock !== lStock) edits.push({ section:'caps', id, field:'stock', value:lStock });
    const bMin = getField(base, 'caps', id, 'min');
    const lMin = getField(local, 'caps', id, 'min');
    if (bMin !== lMin) edits.push({ section:'caps', id, field:'min', value:lMin });
  });

  // Inventario Varios (lista): detectar add/edit/delete (reemplazo completo, conservador)
  const baseV = (base && Array.isArray(base.varios)) ? base.varios : [];
  const localV = (local && Array.isArray(local.varios)) ? local.varios : [];
  if (signatureVarios(baseV) !== signatureVarios(localV)){
    edits.push({ section:'varios', op:'replace', value: deepClone(localV) });
  }

  return edits;
}

function applyEditsToCurrent(cur, edits){
  const out = deepClone(cur);
  if (!out || typeof out !== 'object') return out;
  if (!out.liquids || typeof out.liquids !== 'object') out.liquids = {};
  if (!out.bottles || typeof out.bottles !== 'object') out.bottles = {};
  if (!out.finished || typeof out.finished !== 'object') out.finished = {};
  if (!out.caps || typeof out.caps !== 'object') out.caps = {};
  if (!Array.isArray(out.varios)) out.varios = [];

  edits.forEach((e)=>{
    if (!e || !e.section) return;
    if (e.section === 'varios' && e.op === 'replace'){
      out.varios = deepClone(e.value);
      return;
    }
    if (!e.id || !e.field) return;
    if (!out[e.section] || typeof out[e.section] !== 'object') out[e.section] = {};
    if (!out[e.section][e.id] || typeof out[e.section][e.id] !== 'object') out[e.section][e.id] = {};
    out[e.section][e.id][e.field] = e.value;
  });
  return out;
}

function sharedCommitInventarioConservative(localInv){
  // Releer justo antes de guardar
  const r = readInventarioShared();
  const cur = (r && r.data && typeof r.data === 'object') ? r.data : defaultInventario();
  normalizeInventarioInPlace(cur);
  normalizeInventarioInPlace(localInv);

  const meta = (r && r.meta && typeof r.meta === 'object') ? r.meta : { rev:0, updatedAt:null, writer:'' };
  const curRev = Number.isFinite(+meta.rev) ? Math.trunc(+meta.rev) : 0;

  if (INV_BASE_SNAPSHOT == null){
    trackInventarioBase(cur, meta);
  }

  const base = INV_BASE_SNAPSHOT || defaultInventario();
  const baseRev = Number.isFinite(+INV_BASE_REV) ? Math.trunc(+INV_BASE_REV) : 0;
  const edits = collectEdits(base, localInv);

  if (!edits.length){
    // Nada cambió vs base; re-sincronizar base y salir.
    trackInventarioBase(cur, meta);
    return { ok:true, data: cur, message:'' };
  }

  // Conflicto: otro módulo/pestaña cambió lo MISMO desde nuestra lectura.
  if (curRev !== baseRev){
    for (const e of edits){
      const baseVal = getComparableForEdit(base, e);
      const curVal = getComparableForEdit(cur, e);
      if (baseVal !== curVal){
        return {
          ok:false,
          data: cur,
          message:'Se detectaron cambios recientes en inventario. Recarga y reintenta (para evitar corrupción).'
        };
      }
    }
  }

  const finalData = applyEditsToCurrent(cur, edits);
  const v2 = validateBeforeSave(finalData);
  if (!v2.ok) return { ok:false, data: cur, message: v2.message || 'No se pudo guardar el inventario.' };

  // Anti-race: revisar rev justo antes de escribir
  const metaNow = readInventarioMetaRaw();
  if (Number.isFinite(+metaNow.rev) && Math.trunc(+metaNow.rev) !== curRev){
    return {
      ok:false,
      data: cur,
      message:'Se detectaron cambios recientes. Recarga y vuelve a intentar.'
    };
  }

  // Escribir data + meta (sin sharedSet para poder BLOQUEAR en conflicto)
  try{
    const ok = A33Storage.setItem(STORAGE_KEY_INVENTARIO, JSON.stringify(finalData ?? null), 'local');
    if (!ok){
      return { ok:false, data: cur, message:'No se pudo guardar el inventario (storage lleno o bloqueado).' };
    }
  }catch(err){
    return { ok:false, data: cur, message:'No se pudo guardar el inventario (error de storage).' };
  }

  const metaWritten = writeInventarioMetaRaw(curRev + 1, 'inventario');
  trackInventarioBase(finalData, metaWritten);
  return { ok:true, data: finalData, message:'' };
}

function toFiniteNumber(value){
  const s = String(value ?? '').trim().replace(',', '.');
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function toNonNegativeNumber(value){
  const n = toFiniteNumber(value);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return n;
}

function toNonNegativeInt(value){
  const n = toFiniteNumber(value);
  if (!Number.isFinite(n) || n < 0) return NaN;
  if (!Number.isInteger(n)) return NaN;
  return n;
}


function toIntSafe(value, fallback){
  const n = toFiniteNumber(value);
  const fb = Number.isFinite(+fallback) ? Math.trunc(+fallback) : 0;
  if (!Number.isFinite(n)) return fb;
  return Math.trunc(n);
}

function normalizeCapsSectionInPlace(inv){
  if (!inv || typeof inv !== 'object') return;
  if (!inv.caps || typeof inv.caps !== 'object') inv.caps = defaultCapsSection();

  CAPS_KEYS.forEach((k)=>{
    if (!inv.caps[k] || typeof inv.caps[k] !== 'object') inv.caps[k] = { stock: 0, min: 0 };

    // stock: entero (permitir negativos; no bloquear si llega negativo en el futuro)
    const s = toFiniteNumber(inv.caps[k].stock);
    inv.caps[k].stock = Number.isFinite(s) ? Math.trunc(s) : 0;

    // min: entero >= 0
    const mn = toFiniteNumber(inv.caps[k].min);
    inv.caps[k].min = Number.isFinite(mn) ? Math.max(0, Math.trunc(mn)) : 0;
  });
}

function normalizeVariosSectionInPlace(inv){
  if (!inv || typeof inv !== 'object') return;
  const raw = Array.isArray(inv.varios) ? inv.varios : [];
  const out = [];
  const used = new Set();
  const now = Date.now();

  for (let i = 0; i < raw.length; i++){
    const it = raw[i];
    if (!it || typeof it !== 'object') continue;

    // createdAt: timestamp (ms) entero
    const ca0 = toFiniteNumber(it.createdAt);
    const createdAt = Number.isFinite(ca0) ? Math.trunc(ca0) : now;

    // id: string estable
    let id = (typeof it.id === 'string') ? it.id.trim() : '';
    if (!id) id = `v_${createdAt}_${i}`;

    // producto: string trim
    const producto = String(it.producto ?? '').trim();

    // stock: entero (NEGATIVOS permitidos)
    const st0 = toFiniteNumber(it.stock);
    const stock = Number.isFinite(st0) ? Math.trunc(st0) : 0;

    // minimo: entero >= 0
    const mn0 = toFiniteNumber(it.minimo);
    const minimo = Number.isFinite(mn0) ? Math.max(0, Math.trunc(mn0)) : 0;

    // Unicidad id
    const baseId = id;
    let n = 2;
    while (used.has(id)){
      id = `${baseId}_${n++}`;
    }
    used.add(id);

    out.push({ id, producto, stock, minimo, createdAt });
  }

  // Orden estable (evita diffs por orden)
  out.sort((a,b)=>{
    const da = Number.isFinite(+a.createdAt) ? a.createdAt : 0;
    const db = Number.isFinite(+b.createdAt) ? b.createdAt : 0;
    if (da !== db) return da - db;
    const ia = String(a.id || '');
    const ib = String(b.id || '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });

  inv.varios = out;
}

function normalizeInventarioInPlace(inv){
  if (!inv || typeof inv !== 'object') return defaultInventario();

  if (!inv.liquids || typeof inv.liquids !== 'object') inv.liquids = {};
  if (!inv.bottles || typeof inv.bottles !== 'object') inv.bottles = {};
  if (!inv.finished || typeof inv.finished !== 'object') inv.finished = {};

  // Compat con data vieja: asegurar llaves conocidas y números seguros
  LIQUIDS.forEach((l) => {
    if (!inv.liquids[l.id] || typeof inv.liquids[l.id] !== 'object') inv.liquids[l.id] = { stock: 0, max: 0 };
    const st = toFiniteNumber(inv.liquids[l.id].stock);
    const mx = toFiniteNumber(inv.liquids[l.id].max);
    inv.liquids[l.id].stock = Number.isFinite(st) ? Math.max(0, st) : 0;
    inv.liquids[l.id].max = Number.isFinite(mx) ? Math.max(0, mx) : 0;
  });

  BOTTLES.forEach((b) => {
    if (!inv.bottles[b.id] || typeof inv.bottles[b.id] !== 'object') inv.bottles[b.id] = { stock: 0 };
    const st = toFiniteNumber(inv.bottles[b.id].stock);
    // No forzar entero aquí (mantener comportamiento: valida al guardar)
    inv.bottles[b.id].stock = Number.isFinite(st) ? st : 0;
  });

  FINISHED.forEach((p) => {
    if (!inv.finished[p.id] || typeof inv.finished[p.id] !== 'object') inv.finished[p.id] = { stock: 0 };
    const st = toFiniteNumber(inv.finished[p.id].stock);
    inv.finished[p.id].stock = Number.isFinite(st) ? st : 0;
  });

  // Tapas (Auto)
  normalizeCapsSectionInPlace(inv);

  // Inventario Varios (manual)
  if (!Array.isArray(inv.varios)) inv.varios = [];
  normalizeVariosSectionInPlace(inv);

  return inv;
}


function isValidDateKey(dateKey){
  if (typeof dateKey !== 'string') return false;
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(dateKey);
  if (!m) return false;
  const d = new Date(dateKey + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  // Validación estricta (evita 2026-02-31)
  const [y, mo, da] = dateKey.split('-').map(x => parseInt(x, 10));
  return d.getUTCFullYear() === y && (d.getUTCMonth() + 1) === mo && d.getUTCDate() === da;
}

function validateBeforeSave(inv){
  if (!inv || typeof inv !== 'object'){
    return { ok:false, message:'Inventario inválido: estructura vacía o corrupta.' };
  }

  // Si existe dateKey (por compatibilidad futura), validarlo.
  if (Object.prototype.hasOwnProperty.call(inv, 'dateKey') && inv.dateKey != null){
    if (!isValidDateKey(String(inv.dateKey))){
      return { ok:false, message:'Fecha inválida: dateKey debe ser YYYY-MM-DD.' };
    }
  }

  // Estructura mínima
  if (!inv.liquids || typeof inv.liquids !== 'object'){
    return { ok:false, message:'Inventario inválido: falta sección "liquids".' };
  }
  if (!inv.bottles || typeof inv.bottles !== 'object'){
    return { ok:false, message:'Inventario inválido: falta sección "bottles".' };
  }
  if (!inv.finished || typeof inv.finished !== 'object'){
    // finished puede existir por otros módulos; si no está, no bloqueamos: compat.
    inv.finished = inv.finished || {};
  }

  // Tapas (Auto): compat + validación
  if (!inv.caps || typeof inv.caps !== 'object'){
    inv.caps = defaultCapsSection();
  }
  normalizeCapsSectionInPlace(inv);

  for (const id of Object.keys(inv.caps)){
    const it = inv.caps[id];
    if (!it || typeof it !== 'object') return { ok:false, message:`Inventario inválido: "caps.${id}" corrupto.` };
    if (!Number.isFinite(it.stock)) return { ok:false, message:`Valor inválido en caps.${id}: stock debe ser número.` };
    if (!Number.isInteger(it.stock)) return { ok:false, message:`Valor inválido en caps.${id}: stock debe ser entero.` };
    if (!Number.isFinite(it.min) || it.min < 0) return { ok:false, message:`Valor inválido en caps.${id}: min debe ser entero >= 0.` };
    if (!Number.isInteger(it.min)) return { ok:false, message:`Valor inválido en caps.${id}: min debe ser entero.` };
  }

  // Inventario Varios (manual): compat + validación
  if (!Array.isArray(inv.varios)) inv.varios = [];
  normalizeVariosSectionInPlace(inv);
  for (let i = 0; i < inv.varios.length; i++){
    const it = inv.varios[i];
    if (!it || typeof it !== 'object') return { ok:false, message:'Inventario inválido: línea de varios corrupta.' };
    const id = String(it.id || '').trim();
    if (!id) return { ok:false, message:'Inventario inválido: una línea de varios no tiene id.' };
    // producto puede ir vacío (pendiente) — no bloquea guardado

    if (!Number.isFinite(it.stock)) return { ok:false, message:`Inventario Varios: stock inválido en ${id}.` };
    if (!Number.isInteger(it.stock)) return { ok:false, message:`Inventario Varios: stock debe ser entero en ${id}.` };
    if (!Number.isFinite(it.minimo) || it.minimo < 0) return { ok:false, message:`Inventario Varios: mínimo inválido en ${id}.` };
    if (!Number.isInteger(it.minimo)) return { ok:false, message:`Inventario Varios: mínimo debe ser entero en ${id}.` };
    if (!Number.isFinite(it.createdAt)) return { ok:false, message:`Inventario Varios: createdAt inválido en ${id}.` };
    if (!Number.isInteger(it.createdAt)) return { ok:false, message:`Inventario Varios: createdAt debe ser entero en ${id}.` };
  }

  // Validar valores que este módulo edita
  for (const id of Object.keys(inv.liquids)){
    const it = inv.liquids[id];
    if (!it || typeof it !== 'object') return { ok:false, message:`Inventario inválido: "liquids.${id}" corrupto.` };
    if (!Number.isFinite(it.stock) || it.stock < 0) return { ok:false, message:`Valor inválido en ${id}: stock debe ser número >= 0.` };
    if (!Number.isFinite(it.max) || it.max < 0) return { ok:false, message:`Valor inválido en ${id}: máximo debe ser número >= 0.` };
  }
  for (const id of Object.keys(inv.bottles)){
    const it = inv.bottles[id];
    if (!it || typeof it !== 'object') return { ok:false, message:`Inventario inválido: "bottles.${id}" corrupto.` };
    if (!Number.isFinite(it.stock) || it.stock < 0) return { ok:false, message:`Valor inválido en ${id}: stock de botellas debe ser número >= 0.` };
    // Botellas: unidad entera (sin fracciones)
    if (!Number.isInteger(it.stock)) return { ok:false, message:`Valor inválido en ${id}: el stock de botellas debe ser entero.` };
  }

  return { ok:true, message:'' };
}

function markA33Num(input, { defaultValue = '0', mode = 'decimal' } = {}) {
  try {
    if (!input || !(input instanceof HTMLInputElement)) return;
    if (input.readOnly || input.disabled) return;
    input.classList.add('a33-num');
    input.dataset.a33Default = String(defaultValue);
    input.inputMode = mode;
  } catch (e) {}
}

// ------------------------------
// A33 — Modal numérico (Líquidos)
// Reemplaza window.prompt() para iPad (inputmode decimal real)
// ------------------------------

let __A33_CANT_MODAL = null;
let __A33_CANT_MODAL_OPEN = false;
let __A33_CANT_MODAL_PROMISE = null;

function ensureCantidadModal() {
  if (__A33_CANT_MODAL) return __A33_CANT_MODAL;
  const overlay = $("a33-modal-cantidad");
  if (!overlay) return null;

  const card = overlay.querySelector(".a33-modal-card");
  const titleEl = overlay.querySelector("#a33-modal-cantidad-title");
  const textEl = overlay.querySelector("#a33-modal-cantidad-text");
  const labelEl = overlay.querySelector(".a33-modal-label");
  const inputEl = overlay.querySelector("#a33-modal-cantidad-input");
  const btnOk = overlay.querySelector("#a33-modal-cantidad-ok");
  const btnCancel = overlay.querySelector("#a33-modal-cantidad-cancel");

  __A33_CANT_MODAL = { overlay, card, titleEl, textEl, labelEl, inputEl, btnOk, btnCancel };
  return __A33_CANT_MODAL;
}

function openCantidadModal({
  title = 'Cantidad',
  message = '',
  label = 'Cantidad',
  value = '',
  step = '0.01',
  min = '0',
  mode = 'decimal',
} = {}) {
  const m = ensureCantidadModal();
  if (!m) {
    // Fallback defensivo (no debería pasar si el HTML está presente)
    try { return Promise.resolve(window.prompt(String(message || ''))); } catch (_) { return Promise.resolve(null); }
  }

  // Anti-reentrada: si por algún motivo se intenta abrir el modal mientras ya está abierto,
  // devuelve la promesa vigente (evita listeners duplicados y dobles aplicaciones).
  if (__A33_CANT_MODAL_OPEN && __A33_CANT_MODAL_PROMISE) return __A33_CANT_MODAL_PROMISE;

  const { overlay, card, titleEl, textEl, labelEl, inputEl, btnOk, btnCancel } = m;
  const prevFocus = document.activeElement;

  // Configurar contenido
  try { if (titleEl) titleEl.textContent = String(title || 'Cantidad'); } catch (_) {}
  try { if (textEl) textEl.textContent = String(message || ''); } catch (_) {}
  try { if (labelEl) labelEl.textContent = String(label || 'Cantidad'); } catch (_) {}

  // Configurar input (decimal/numeric)
  try {
    inputEl.step = String(step || '0.01');
    inputEl.min = String((min == null) ? '0' : min);
    inputEl.value = (value == null) ? '' : String(value);
    try { inputEl.inputMode = String(mode || 'decimal'); } catch (_) {}
    try { inputEl.setAttribute('inputmode', String(mode || 'decimal')); } catch (_) {}
    // UX A33 numérica: select-all si hay valor; si vacío, no inyectar "0"
    const fn = (typeof window !== 'undefined' && typeof window.markA33Num === 'function') ? window.markA33Num : markA33Num;
    try { fn(inputEl, { defaultValue: '', mode: String(mode || 'decimal') }); } catch (_) {}
  } catch (_) {}

  // Mostrar
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');

  // Rehabilitar botones por si quedaron deshabilitados por un cierre previo
  try { if (btnOk) btnOk.disabled = false; } catch (_) {}
  try { if (btnCancel) btnCancel.disabled = false; } catch (_) {}

  // Evitar click-through
  try { overlay.scrollTop = 0; } catch (_) {}

  // Focus al input
  try {
    requestAnimationFrame(() => {
      try { inputEl.focus({ preventScroll: true }); } catch (_) { try { inputEl.focus(); } catch (__){ } }
      // Si en el futuro se usa value prellenado, seleccionar todo para edición rápida.
      try {
        const v = String(inputEl.value ?? '');
        if (v) { try { inputEl.select(); } catch (_) { try { inputEl.setSelectionRange(0, v.length); } catch(__){} } }
      } catch (_) {}
    });
  } catch (_) {
    try { setTimeout(() => { try { inputEl.focus(); } catch(__){} }, 0); } catch(__){}
  }

  __A33_CANT_MODAL_OPEN = true;
  __A33_CANT_MODAL_PROMISE = new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      try { btnOk && btnOk.removeEventListener('click', onOk); } catch (_) {}
      try { btnCancel && btnCancel.removeEventListener('click', onCancel); } catch (_) {}
      try { overlay.removeEventListener('click', onOverlayClick); } catch (_) {}
      try { card && card.removeEventListener('click', onCardClick); } catch (_) {}
      try { document.removeEventListener('keydown', onKeyDown); } catch (_) {}
      try { inputEl && inputEl.removeEventListener('keydown', onInputKeyDown); } catch (_) {}
    };
    const close = (result) => {
      if (done) return;
      done = true;
      cleanup();
      try { overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); } catch (_) {}
      __A33_CANT_MODAL_OPEN = false;
      __A33_CANT_MODAL_PROMISE = null;
      // Restaurar foco
      try {
        if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus({ preventScroll: true });
      } catch (_) { try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch(__){} }
      resolve(result);
    };

    const onOk = () => {
      // Anti doble tap
      try { if (btnOk) btnOk.disabled = true; } catch (_) {}
      try { if (btnCancel) btnCancel.disabled = true; } catch (_) {}
      try { close(String(inputEl.value ?? '').trim()); } catch (_) { close(''); }
    };
    const onCancel = () => {
      // Anti doble tap
      try { if (btnOk) btnOk.disabled = true; } catch (_) {}
      try { if (btnCancel) btnCancel.disabled = true; } catch (_) {}
      close(null);
    };
    const onOverlayClick = (ev) => {
      // Tap fuera del card
      if (ev && ev.target === overlay) close(null);
    };
    const onCardClick = (ev) => {
      try { ev && ev.stopPropagation(); } catch (_) {}
    };
    const onKeyDown = (ev) => {
      if (!ev) return;
      if (ev.key === 'Escape') {
        try { ev.preventDefault(); } catch (_) {}
        close(null);
      }
    };
    const onInputKeyDown = (ev) => {
      if (!ev) return;
      if (ev.key === 'Enter') {
        try { ev.preventDefault(); } catch (_) {}
        onOk();
      }
    };

    try { btnOk && btnOk.addEventListener('click', onOk); } catch (_) {}
    try { btnCancel && btnCancel.addEventListener('click', onCancel); } catch (_) {}
    try { overlay.addEventListener('click', onOverlayClick); } catch (_) {}
    try { card && card.addEventListener('click', onCardClick); } catch (_) {}
    try { document.addEventListener('keydown', onKeyDown); } catch (_) {}
    try { inputEl && inputEl.addEventListener('keydown', onInputKeyDown); } catch (_) {}
  });

  return __A33_CANT_MODAL_PROMISE;
}

// ------------------------------
// Inventario — Etapa 3 (iPad-first + rendimiento)
// - Sin scroll horizontal en iPad (tarjetas via CSS + data-labels en celdas)
// - Render incremental (sin rehacer listas completas)
// - Paginación simple ("Cargar más")
// - Estados visibles: cargando / guardando / sin resultados / errores
// ------------------------------

const INV_UI = {
  // suficientemente alto para mostrar todo por defecto (sin filtros)
  pageSize: 9999,
  pages: { liquids: 1, bottles: 1, finished: 1 },
};

const INV_VIEW = {
  liquids: { tbodyId: "inv-liquidos-body", emptyId: "inv-liquidos-empty", moreId: "inv-liquidos-more" },
  bottles: { tbodyId: "inv-botellas-body", emptyId: "inv-botellas-empty", moreId: "inv-botellas-more" },
  finished: { tbodyId: "inv-productos-body", emptyId: "inv-productos-empty", moreId: "inv-productos-more" },
};

const INV_ROW_CACHE = {
  liquids: new Map(),
  bottles: new Map(),
  finished: new Map(),
  caps: new Map(),
  varios: new Map(),
};

// UI state (no persistente)
const INV_VARIOS_UI = {
  search: "",
};

function debounce(fn, waitMs) {
  let t = null;
  return function debounced(...args) {
    try { if (t) clearTimeout(t); } catch (e) {}
    t = setTimeout(() => fn.apply(null, args), waitMs);
  };
}

function setStatus(text, kind = "info", { sticky = false, timeoutMs = 2200 } = {}) {
  const el = $("inv-status");
  if (!el) return;
  const msg = String(text || "");
  el.textContent = msg;
  el.classList.remove("inv-status--info", "inv-status--ok", "inv-status--warn", "inv-status--error");
  el.classList.add(`inv-status--${kind}`);

  if (!sticky && msg) {
    setTimeout(() => {
      // limpiar solo si no cambió
      if (el.textContent === msg) {
        el.textContent = "";
        el.classList.remove("inv-status--info", "inv-status--ok", "inv-status--warn", "inv-status--error");
        el.classList.add("inv-status--info");
      }
    }, timeoutMs);
  }
}

function applyView(section) {
  const view = INV_VIEW[section];
  const cache = INV_ROW_CACHE[section];
  if (!view || !cache) return;

  const page = INV_UI.pages[section] || 1;
  const limit = INV_UI.pageSize * page;

  const defs = section === "liquids" ? LIQUIDS : (section === "bottles" ? BOTTLES : FINISHED);

  let matched = 0;
  defs.forEach((d) => {
    const row = cache.get(d.id);
    if (!row || !row.tr) return;
    matched += 1;
    row.tr.hidden = matched > limit;
  });

  const emptyEl = $(view.emptyId);
  if (emptyEl) emptyEl.hidden = matched > 0;

  const moreEl = $(view.moreId);
  if (moreEl) moreEl.hidden = matched <= limit;
}

function applyAllViews() {
  applyView("liquids");
  applyView("bottles");
  applyView("finished");
}

function wireViewControls() {
  // Solo paginación ("Cargar más"). Sin buscador.
  ["liquids", "bottles", "finished"].forEach((section) => {
    const view = INV_VIEW[section];
    if (!view) return;
    const more = $(view.moreId);
    if (!more) return;
    more.addEventListener("click", () => {
      INV_UI.pages[section] = (INV_UI.pages[section] || 1) + 1;
      applyView(section);
    });
  });
}

function tdLabel(td, label) {
  try { td.setAttribute("data-label", label); } catch (e) {}
  return td;
}

function ensureLiquidoRow(tbody, def) {
  const id = def.id;
  let row = INV_ROW_CACHE.liquids.get(id);
  if (row && row.tr && row.tr.parentElement !== tbody) {
    tbody.appendChild(row.tr);
    return row;
  }
  if (row) return row;

  const tr = document.createElement("tr");
  tr.dataset.section = "liquids";
  tr.dataset.rowId = id;

  const tdNombre = tdLabel(document.createElement("td"), "Ingrediente");
  tdNombre.textContent = def.nombre;
  tr.appendChild(tdNombre);

  const tdStock = tdLabel(document.createElement("td"), "Stock actual (ml)");
  const inputStock = document.createElement("input");
  inputStock.type = "number";
  inputStock.step = "0.01";
  inputStock.min = "0";
  inputStock.dataset.id = id;
  inputStock.dataset.kind = "liquid-stock";
  markA33Num(inputStock, { defaultValue: "0", mode: "decimal" });
  tdStock.appendChild(inputStock);
  tr.appendChild(tdStock);

  const tdMax = tdLabel(document.createElement("td"), "Stock máximo (ml)");
  const inputMax = document.createElement("input");
  inputMax.type = "number";
  inputMax.step = "0.01";
  inputMax.min = "0";
  inputMax.dataset.id = id;
  inputMax.dataset.kind = "liquid-max";
  markA33Num(inputMax, { defaultValue: "0", mode: "decimal" });
  tdMax.appendChild(inputMax);
  tr.appendChild(tdMax);

  const tdPct = tdLabel(document.createElement("td"), "% restante");
  tdPct.textContent = "—";
  tr.appendChild(tdPct);

  const tdEstado = tdLabel(document.createElement("td"), "Estado");
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-chip status-neutral";
  statusSpan.textContent = "—";
  tdEstado.appendChild(statusSpan);
  tr.appendChild(tdEstado);

  const tdAcciones = tdLabel(document.createElement("td"), "Acciones");
  tdAcciones.className = "td-actions";
  const divAcc = document.createElement("div");
  divAcc.className = "inv-actions";

  const btnEntrada = document.createElement("button");
  btnEntrada.type = "button";
  btnEntrada.textContent = "+";
  btnEntrada.title = "Entrada";
  btnEntrada.setAttribute("aria-label", "Entrada");
  btnEntrada.className = "btn-secondary btn-mini";
  btnEntrada.dataset.action = "entrada";
  btnEntrada.dataset.id = id;
  btnEntrada.dataset.kind = "liquid";

  const btnSalida = document.createElement("button");
  btnSalida.type = "button";
  btnSalida.textContent = "−";
  btnSalida.title = "Salida";
  btnSalida.setAttribute("aria-label", "Salida");
  btnSalida.className = "btn-danger btn-mini";
  btnSalida.dataset.action = "salida";
  btnSalida.dataset.id = id;
  btnSalida.dataset.kind = "liquid";

  divAcc.appendChild(btnEntrada);
  divAcc.appendChild(btnSalida);
  tdAcciones.appendChild(divAcc);
  tr.appendChild(tdAcciones);

  tbody.appendChild(tr);

  row = { tr, inputStock, inputMax, tdPct, statusSpan };
  INV_ROW_CACHE.liquids.set(id, row);
  return row;
}

function updateLiquidoRow(inv, id) {
  const row = INV_ROW_CACHE.liquids.get(id);
  if (!row) return;

  const info = (inv && inv.liquids && inv.liquids[id]) ? inv.liquids[id] : { stock: 0, max: 0 };
  const stock = parseNumber(info.stock);
  const max = parseNumber(info.max);

  if (document.activeElement !== row.inputStock) row.inputStock.value = Number.isFinite(stock) ? stock : 0;
  if (document.activeElement !== row.inputMax) row.inputMax.value = Number.isFinite(max) ? max : 0;

  const pct = max > 0 ? (stock / max) * 100 : 0;
  row.tdPct.textContent = max > 0 ? pct.toFixed(1) + " %" : "—";

  const estado = calcularEstadoLiquido({ stock, max });
  row.statusSpan.className = "status-chip " + estado.className;
  row.statusSpan.textContent = estado.label;
}

function ensureBottleRow(tbody, def) {
  const id = def.id;
  let row = INV_ROW_CACHE.bottles.get(id);
  if (row && row.tr && row.tr.parentElement !== tbody) {
    tbody.appendChild(row.tr);
    return row;
  }
  if (row) return row;

  const tr = document.createElement("tr");
  tr.dataset.section = "bottles";
  tr.dataset.rowId = id;
	  

  const tdNombre = tdLabel(document.createElement("td"), "Presentación");
  tdNombre.textContent = def.nombre;
  tr.appendChild(tdNombre);

  const tdStock = tdLabel(document.createElement("td"), "Stock actual (unid.)");
  const inputStock = document.createElement("input");
  inputStock.type = "number";
  inputStock.step = "1";
  inputStock.min = "0";
  inputStock.dataset.id = id;
  inputStock.dataset.kind = "bottle-stock";
  markA33Num(inputStock, { defaultValue: "0", mode: "numeric" });
  tdStock.appendChild(inputStock);
  tr.appendChild(tdStock);

  const tdEstado = tdLabel(document.createElement("td"), "Estado");
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-chip status-neutral";
  statusSpan.textContent = "—";
  tdEstado.appendChild(statusSpan);
  tr.appendChild(tdEstado);

  const tdAcciones = tdLabel(document.createElement("td"), "Acciones");
  tdAcciones.className = "td-actions";
  const divAcc = document.createElement("div");
  divAcc.className = "inv-actions";

  const btnEntrada = document.createElement("button");
  btnEntrada.type = "button";
  btnEntrada.textContent = "+";
  btnEntrada.title = "Entrada";
  btnEntrada.setAttribute("aria-label", "Entrada");
  btnEntrada.className = "btn-secondary btn-mini";
  btnEntrada.dataset.action = "entrada";
  btnEntrada.dataset.id = id;
  btnEntrada.dataset.kind = "bottle";

  const btnSalida = document.createElement("button");
  btnSalida.type = "button";
  btnSalida.textContent = "−";
  btnSalida.title = "Salida";
  btnSalida.setAttribute("aria-label", "Salida");
  btnSalida.className = "btn-danger btn-mini";
  btnSalida.dataset.action = "salida";
  btnSalida.dataset.id = id;
  btnSalida.dataset.kind = "bottle";

  divAcc.appendChild(btnEntrada);
  divAcc.appendChild(btnSalida);
  tdAcciones.appendChild(divAcc);
  tr.appendChild(tdAcciones);

  tbody.appendChild(tr);

  row = { tr, inputStock, statusSpan };
  INV_ROW_CACHE.bottles.set(id, row);
  return row;
}

function updateBottleRow(inv, id) {
  const row = INV_ROW_CACHE.bottles.get(id);
  if (!row) return;

  const info = (inv && inv.bottles && inv.bottles[id]) ? inv.bottles[id] : { stock: 0 };
  const stock = parseNumber(info.stock);

  if (document.activeElement !== row.inputStock) row.inputStock.value = Number.isFinite(stock) ? stock : 0;

  const estado = calcularEstadoBotella({ stock });
  row.statusSpan.className = "status-chip " + estado.className;
  row.statusSpan.textContent = estado.label;
}

function calcularEstadoTapa(t) {
  const stock = parseNumber(t.stock);
  const minimo = parseNumber(t.min);
  if (stock <= 0) {
    return { label: "Sin stock", className: "status-critical" };
  }
  if (stock <= minimo) {
    return { label: "Bajo", className: "status-warn" };
  }
  return { label: "OK", className: "status-ok" };
}

function ensureCapRow(tbody, def) {
  const id = def.id;
  let row = INV_ROW_CACHE.caps.get(id);
  if (row && row.tr && row.tr.parentElement !== tbody) {
    tbody.appendChild(row.tr);
    return row;
  }
  if (row) return row;

  const tr = document.createElement("tr");
  tr.dataset.section = "caps";
  tr.dataset.rowId = id;

  const tdNombre = tdLabel(document.createElement("td"), "Tipo");
  tdNombre.textContent = def.nombre;
  tr.appendChild(tdNombre);

  const tdStock = tdLabel(document.createElement("td"), "Stock (unid.)");
  const inputStock = document.createElement("input");
  inputStock.type = "number";
  inputStock.step = "1";
  // permitir negativos (no bloquear)
  inputStock.dataset.id = id;
  inputStock.dataset.kind = "cap-stock";
  markA33Num(inputStock, { defaultValue: "0", mode: "numeric" });
  tdStock.appendChild(inputStock);
  tr.appendChild(tdStock);

  const tdMin = tdLabel(document.createElement("td"), "Mínimo");
  const inputMin = document.createElement("input");
  inputMin.type = "number";
  inputMin.step = "1";
  inputMin.min = "0";
  inputMin.dataset.id = id;
  inputMin.dataset.kind = "cap-min";
  markA33Num(inputMin, { defaultValue: "0", mode: "numeric" });
  tdMin.appendChild(inputMin);
  tr.appendChild(tdMin);

  const tdEstado = tdLabel(document.createElement("td"), "Estado");
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-chip status-neutral";
  statusSpan.textContent = "—";
  tdEstado.appendChild(statusSpan);
  tr.appendChild(tdEstado);

  const tdAcciones = tdLabel(document.createElement("td"), "Acciones");
  tdAcciones.className = "td-actions";
  const divAcc = document.createElement("div");
  divAcc.className = "inv-actions";

  const btnEntrada = document.createElement("button");
  btnEntrada.type = "button";
  btnEntrada.textContent = "+";
  btnEntrada.title = "Entrada";
  btnEntrada.setAttribute("aria-label", "Entrada");
  btnEntrada.className = "btn-secondary btn-mini";
  btnEntrada.dataset.action = "entrada";
  btnEntrada.dataset.id = id;
  btnEntrada.dataset.kind = "cap";

  const btnSalida = document.createElement("button");
  btnSalida.type = "button";
  btnSalida.textContent = "−";
  btnSalida.title = "Salida";
  btnSalida.setAttribute("aria-label", "Salida");
  btnSalida.className = "btn-danger btn-mini";
  btnSalida.dataset.action = "salida";
  btnSalida.dataset.id = id;
  btnSalida.dataset.kind = "cap";

  divAcc.appendChild(btnEntrada);
  divAcc.appendChild(btnSalida);
  tdAcciones.appendChild(divAcc);
  tr.appendChild(tdAcciones);

  tbody.appendChild(tr);

  row = { tr, inputStock, inputMin, statusSpan };
  INV_ROW_CACHE.caps.set(id, row);
  return row;
}

function updateCapRow(inv, id) {
  const row = INV_ROW_CACHE.caps.get(id);
  if (!row) return;

  const info = (inv && inv.caps && inv.caps[id]) ? inv.caps[id] : { stock: 0, min: 0 };
  const stock = parseNumber(info.stock);
  const minimo = parseNumber(info.min);

  if (document.activeElement !== row.inputStock) row.inputStock.value = Number.isFinite(stock) ? stock : 0;
  if (document.activeElement !== row.inputMin) row.inputMin.value = Number.isFinite(minimo) ? minimo : 0;

  const estado = calcularEstadoTapa({ stock, min: minimo });
  row.statusSpan.className = "status-chip " + estado.className;
  row.statusSpan.textContent = estado.label;
}

function ensureFinishedRow(tbody, def) {
  const id = def.id;
  let row = INV_ROW_CACHE.finished.get(id);
  if (row && row.tr && row.tr.parentElement !== tbody) {
    tbody.appendChild(row.tr);
    return row;
  }
  if (row) return row;

  const tr = document.createElement("tr");
  tr.dataset.section = "finished";
  tr.dataset.rowId = id;
	  

  const tdNombre = tdLabel(document.createElement("td"), "Presentación");
  tdNombre.textContent = def.nombre;
  tr.appendChild(tdNombre);

  const tdStock = tdLabel(document.createElement("td"), "Stock (unid.)");
  tdStock.textContent = "0";
  tr.appendChild(tdStock);

  const tdEstado = tdLabel(document.createElement("td"), "Estado");
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-chip status-neutral";
  statusSpan.textContent = "—";
  tdEstado.appendChild(statusSpan);
  tr.appendChild(tdEstado);

  tbody.appendChild(tr);

  row = { tr, tdStock, statusSpan };
  INV_ROW_CACHE.finished.set(id, row);
  return row;
}

function updateFinishedRow(inv, id) {
  const row = INV_ROW_CACHE.finished.get(id);
  if (!row) return;

  const info = (inv && inv.finished && inv.finished[id]) ? inv.finished[id] : { stock: 0 };
  const stock = parseNumber(info.stock);

  row.tdStock.textContent = Number.isFinite(stock) ? stock.toFixed(0) : "0";

  const estado = calcularEstadoProductoTerminado({ stock });
  row.statusSpan.className = "status-chip " + estado.className;
  row.statusSpan.textContent = estado.label;
}



function calcularEstadoVariosLinea(it){
  const stock = parseNumber(it && it.stock != null ? it.stock : 0);
  const minimo = parseNumber(it && it.minimo != null ? it.minimo : 0);
  if (stock <= 0) return { label: "Sin stock", className: "status-critical" };
  if (stock <= minimo) return { label: "Bajo", className: "status-warn" };
  return { label: "OK", className: "status-ok" };
}

function rankVariosLinea(it){
  // 0 = rojo, 1 = amarillo, 2 = verde
  const stock = parseNumber(it && it.stock != null ? it.stock : 0);
  const minimo = parseNumber(it && it.minimo != null ? it.minimo : 0);
  if (stock <= 0) return 0;
  if (stock <= minimo) return 1;
  return 2;
}

function productoKeyVarios(it){
  const p = String((it && it.producto) ?? "").trim().toLowerCase();
  // Vacíos al final dentro del grupo
  return p ? p : "\uffff";
}

function sortVariosForUI(list){
  try{
    const arr = Array.isArray(list) ? list.slice() : [];
    arr.sort((a, b) => {
      const ra = rankVariosLinea(a);
      const rb = rankVariosLinea(b);
      if (ra !== rb) return ra - rb;
      const pa = productoKeyVarios(a);
      const pb = productoKeyVarios(b);
      if (pa < pb) return -1;
      if (pa > pb) return 1;
      const ca = Number.isFinite(+((a && a.createdAt))) ? Math.trunc(+a.createdAt) : 0;
      const cb = Number.isFinite(+((b && b.createdAt))) ? Math.trunc(+b.createdAt) : 0;
      if (ca !== cb) return ca - cb;
      const ia = String((a && a.id) || "");
      const ib = String((b && b.id) || "");
      if (ia < ib) return -1;
      if (ia > ib) return 1;
      return 0;
    });
    return arr;
  }catch(_){
    return Array.isArray(list) ? list : [];
  }
}

function ensureVariosRow(tbody, it){
  const id = String(it && it.id ? it.id : "");
  let row = INV_ROW_CACHE.varios.get(id);
  if (row && row.tr && row.tr.parentElement !== tbody) {
    tbody.appendChild(row.tr);
    return row;
  }
  if (row) return row;

  const tr = document.createElement("tr");
  tr.dataset.section = "varios";
  tr.dataset.rowId = id;

  const tdProd = tdLabel(document.createElement("td"), "Producto");
  const inpProd = document.createElement("input");
  inpProd.type = "text";
  inpProd.placeholder = "Ej: Vasos";
  inpProd.dataset.id = id;
  inpProd.dataset.kind = "varios-producto";
  inpProd.className = "varios-producto";
  tdProd.appendChild(inpProd);
  tr.appendChild(tdProd);

  const tdStock = tdLabel(document.createElement("td"), "Stock");
  const stockWrap = document.createElement("div");
  stockWrap.className = "varios-stock-wrap";

  const btnMinus = document.createElement("button");
  btnMinus.type = "button";
  btnMinus.className = "btn secondary btn-mini varios-delta-btn";
  btnMinus.textContent = "−";
  btnMinus.dataset.action = "varios-delta";
  btnMinus.dataset.delta = "-1";
  btnMinus.dataset.id = id;

  const inpStock = document.createElement("input");
  inpStock.type = "number";
  inpStock.step = "1";
  inpStock.dataset.id = id;
  inpStock.dataset.kind = "varios-stock";
  inpStock.className = "varios-stock";
  markA33Num(inpStock, { defaultValue: "0", mode: "numeric" });

  const btnPlus = document.createElement("button");
  btnPlus.type = "button";
  btnPlus.className = "btn secondary btn-mini varios-delta-btn";
  btnPlus.textContent = "+";
  btnPlus.dataset.action = "varios-delta";
  btnPlus.dataset.delta = "1";
  btnPlus.dataset.id = id;

  stockWrap.appendChild(btnMinus);
  stockWrap.appendChild(inpStock);
  stockWrap.appendChild(btnPlus);
  tdStock.appendChild(stockWrap);
  tr.appendChild(tdStock);

  const tdMin = tdLabel(document.createElement("td"), "Mínimo");
  const inpMin = document.createElement("input");
  inpMin.type = "number";
  inpMin.step = "1";
  inpMin.min = "0";
  inpMin.dataset.id = id;
  inpMin.dataset.kind = "varios-minimo";
  inpMin.className = "varios-minimo";
  markA33Num(inpMin, { defaultValue: "0", mode: "numeric" });
  tdMin.appendChild(inpMin);
  tr.appendChild(tdMin);

  const tdEstado = tdLabel(document.createElement("td"), "Estado");
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-chip status-neutral";
  statusSpan.textContent = "—";
  tdEstado.appendChild(statusSpan);
  tr.appendChild(tdEstado);

  const tdDel = tdLabel(document.createElement("td"), "Eliminar");
  tdDel.className = "td-actions";
  const btnDel = document.createElement("button");
  btnDel.type = "button";
  btnDel.className = "btn danger btn-mini varios-delete-btn";
  btnDel.textContent = "Eliminar";
  btnDel.dataset.action = "varios-delete";
  btnDel.dataset.id = id;
  tdDel.appendChild(btnDel);
  tr.appendChild(tdDel);

  tbody.appendChild(tr);

  row = { tr, inpProd, inpStock, inpMin, statusSpan };
  INV_ROW_CACHE.varios.set(id, row);
  return row;
}

function updateVariosRow(inv, id){
  const row = INV_ROW_CACHE.varios.get(String(id));
  if (!row) return;
  const list = Array.isArray(inv && inv.varios) ? inv.varios : [];
  const it = list.find((x) => String(x && x.id) === String(id));
  if (!it){
    try{ row.tr.remove(); }catch(_){ }
    INV_ROW_CACHE.varios.delete(String(id));
    return;
  }

  row.inpProd.value = String(it.producto ?? "");
  const prodTrim = String(it.producto ?? "").trim();
  if (!prodTrim) row.inpProd.classList.add("varios-pending");
  else row.inpProd.classList.remove("varios-pending");

  row.inpStock.value = String(Number.isFinite(it.stock) ? it.stock : 0);
  row.inpMin.value = String(Number.isFinite(it.minimo) ? it.minimo : 0);

  const estado = calcularEstadoVariosLinea({ stock: it.stock, minimo: it.minimo });
  row.statusSpan.className = "status-chip " + estado.className;
  row.statusSpan.textContent = estado.label;
}

function renderVarios(inv, { focusId = null } = {}){
  const tbody = $("inv-varios-body");
  if (!tbody) return;

  if (!inv || typeof inv !== "object") return;
  if (!Array.isArray(inv.varios)) inv.varios = [];
  normalizeVariosSectionInPlace(inv);

  // Limpiar cache de filas que ya no existen
  const idsAll = new Set(inv.varios.map((it) => String(it && it.id)));
  Array.from(INV_ROW_CACHE.varios.keys()).forEach((k) => {
    if (!idsAll.has(k)){
      const row = INV_ROW_CACHE.varios.get(k);
      try{ if (row && row.tr) row.tr.remove(); }catch(_){ }
      INV_ROW_CACHE.varios.delete(k);
    }
  });

  // Orden inteligente (rojo > amarillo > verde, luego alfabético)
  const sortedAll = sortVariosForUI(inv.varios);

  // Búsqueda (case-insensitive, trim). No cambia modelo, solo UI.
  const q = String((INV_VARIOS_UI && INV_VARIOS_UI.search) ? INV_VARIOS_UI.search : "").trim().toLowerCase();
  const focusStr = focusId ? String(focusId) : "";
  const filtered = !q ? sortedAll : sortedAll.filter((it) => {
    const prod = String((it && it.producto) || "").toLowerCase();
    const match = prod.includes(q);
    if (match) return true;
    // Si estamos enfocando una línea nueva, mostrarla aunque no coincida.
    return focusStr && String((it && it.id) || "") === focusStr;
  });

  // Asegurar DOM/inputs para todas las líneas (cache), pero solo dejar visibles las filtradas
  inv.varios.forEach((it) => {
    ensureVariosRow(tbody, it);
    updateVariosRow(inv, String(it.id));
  });

  const showIds = new Set(filtered.map((it) => String(it && it.id)));
  Array.from(INV_ROW_CACHE.varios.keys()).forEach((k) => {
    const row = INV_ROW_CACHE.varios.get(k);
    if (!row || !row.tr) return;
    if (!showIds.has(k)){
      try{ row.tr.remove(); }catch(_){ }
    }
  });

  // Render visible en orden
  let matched = 0;
  filtered.forEach((it) => {
    const row = ensureVariosRow(tbody, it);
    updateVariosRow(inv, String(it.id));
    matched += 1;
    if (row && row.tr) tbody.appendChild(row.tr);
  });

  const emptyEl = $("inv-varios-empty");
  if (emptyEl){
    emptyEl.hidden = matched > 0;
    if (!emptyEl.hidden){
      if (inv.varios.length > 0 && q) emptyEl.textContent = "Sin coincidencias.";
      else emptyEl.textContent = "Sin líneas. Agrega una para comenzar.";
    }
  }

  if (focusId){
    const row = INV_ROW_CACHE.varios.get(String(focusId));
    if (row && row.inpProd){
      setTimeout(() => {
        try{ row.tr.scrollIntoView({ block: "nearest" }); }catch(_){ }
        try{ row.inpProd.focus(); row.inpProd.select(); }catch(_){ }
      }, 0);
    }
  }
}


function loadInventario() {
  try {
    // Contrato compartido (anti-pisadas + data vieja segura)
    if (window.A33Storage && typeof A33Storage.sharedRead === 'function'){
      const r = A33Storage.sharedRead(STORAGE_KEY_INVENTARIO, defaultInventario(), 'local');
      const data = (r && r.data && typeof r.data === 'object') ? r.data : defaultInventario();
      const meta = (r && r.meta && typeof r.meta === 'object') ? r.meta : { rev:0, updatedAt:null, writer:'' };
      normalizeInventarioInPlace(data);
      trackInventarioBase(data, meta);
      return data;
    }
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
      const data = A33Storage.sharedGet(STORAGE_KEY_INVENTARIO, defaultInventario());
      const out = (data && typeof data === 'object') ? data : defaultInventario();
      normalizeInventarioInPlace(out);
      return out;
    }

    // Fallback legacy
    const raw = A33Storage.getItem(STORAGE_KEY_INVENTARIO);
    let data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== "object") data = defaultInventario();

    if (!data.liquids) data.liquids = {};
    if (!data.bottles) data.bottles = {};
    if (!data.finished) data.finished = {};

    LIQUIDS.forEach((l) => {
      if (!data.liquids[l.id]) data.liquids[l.id] = { stock: 0, max: 0 };
      if (typeof data.liquids[l.id].stock !== "number") data.liquids[l.id].stock = parseNumber(data.liquids[l.id].stock || 0);
      if (typeof data.liquids[l.id].max !== "number") data.liquids[l.id].max = parseNumber(data.liquids[l.id].max || 0);
    });
    BOTTLES.forEach((b) => {
      if (!data.bottles[b.id]) data.bottles[b.id] = { stock: 0 };
      if (typeof data.bottles[b.id].stock !== "number") data.bottles[b.id].stock = parseNumber(data.bottles[b.id].stock || 0);
    });
    FINISHED.forEach((p) => {
      if (!data.finished[p.id]) data.finished[p.id] = { stock: 0 };
      if (typeof data.finished[p.id].stock !== "number") data.finished[p.id].stock = parseNumber(data.finished[p.id].stock || 0);
    });

    normalizeCapsSectionInPlace(data);
    if (!Array.isArray(data.varios)) data.varios = [];
    normalizeVariosSectionInPlace(data);

    return data;
  } catch (e) {
    console.error("Error leyendo inventario", e);
    safeAlert('Error leyendo inventario. Se cargó un inventario por defecto para evitar corrupción.');
    return defaultInventario();
  }
}

function saveInventario(inv) {
  // Normalizar (compat data vieja) antes de validar/persistir
  normalizeInventarioInPlace(inv);

  // Validaciones duras antes de persistir
  const v = validateBeforeSave(inv);
  if (!v.ok){
    safeAlert(v.message);
    return false;
  }

  try{
    if (window.A33Storage && typeof A33Storage.sharedRead === 'function'){
      const r = sharedCommitInventarioConservative(inv);
      if (!r || !r.ok){
        safeAlert((r && r.message) ? r.message : 'No se pudo guardar el inventario.');
        return false;
      }
      // Sincronizar objeto en memoria con lo realmente guardado (incluye cambios de otros módulos)
      if (r.data && typeof r.data === 'object'){
        inv.liquids = r.data.liquids;
        inv.bottles = r.data.bottles;
        inv.finished = r.data.finished;
        inv.caps = r.data.caps;
        inv.varios = r.data.varios;
      }
      return true;
    }
    if (window.A33Storage && typeof A33Storage.sharedSet === 'function'){
      const r = A33Storage.sharedSet(STORAGE_KEY_INVENTARIO, inv, { source: 'inventario' });
      if (r && r.ok === false){
        safeAlert(r.message || 'No se pudo guardar el inventario.');
        return false;
      }
      // track base best-effort
      try{ trackInventarioBase(inv, A33Storage.sharedGetMeta ? A33Storage.sharedGetMeta(STORAGE_KEY_INVENTARIO, 'local') : { rev:0, updatedAt:null, writer:'' }); }catch(_){ }
      return true;
    }
  }catch(err){
    console.error('Error guardando inventario (sharedSet)', err);
    safeAlert('No se pudo guardar el inventario (error de storage).');
    return false;
  }

  // Fallback legacy
  try{
    const ok = A33Storage.setItem(STORAGE_KEY_INVENTARIO, JSON.stringify(inv));
    if (!ok) safeAlert('No se pudo guardar el inventario (storage lleno o bloqueado).');
    return !!ok;
  }catch(err){
    console.error('Error guardando inventario (legacy)', err);
    safeAlert('No se pudo guardar el inventario (error de storage).');
    return false;
  }
}

function calcularEstadoLiquido(liq) {
  const stock = parseNumber(liq.stock);
  const max = parseNumber(liq.max);
  if (max <= 0) {
    if (stock <= 0) {
      return { label: "Sin stock", className: "status-neutral" };
    }
    return { label: "Sin máximo definido", className: "status-neutral" };
  }
  const pct = (stock / max) * 100;
  if (stock <= 0) {
    return { label: "Sin stock", className: "status-critical" };
  }
  if (pct <= 20) {
    return { label: `Bajo (${pct.toFixed(1)}%)`, className: "status-warn" };
  }
  return { label: `OK (${pct.toFixed(1)}%)`, className: "status-ok" };
}

function calcularEstadoBotella(b) {
  const stock = parseNumber(b.stock);
  if (stock <= 0) {
    return { label: "Sin stock", className: "status-critical" };
  }
  if (stock <= 10) {
    return { label: `Bajo (${stock} unid.)`, className: "status-warn" };
  }
  return { label: `OK (${stock} unid.)`, className: "status-ok" };
}

function renderLiquidos(inv) {
  const tbody = $("inv-liquidos-body");
  if (!tbody) return;

  LIQUIDS.forEach((l) => {
    ensureLiquidoRow(tbody, l);
    // setear valores
    updateLiquidoRow(inv, l.id);
  });

  applyView("liquids");
}



function renderBotellas(inv) {
  const tbody = $("inv-botellas-body");
  if (!tbody) return;

  BOTTLES.forEach((b) => {
    ensureBottleRow(tbody, b);
    updateBottleRow(inv, b.id);
  });

  applyView("bottles");
}

function renderCaps(inv) {
  const tbody = $("inv-caps-body");
  if (!tbody) return;

  CAPS.forEach((c) => {
    ensureCapRow(tbody, c);
    updateCapRow(inv, c.id);
  });
}



function attachListeners(inv) {
  const liquidosBody = $("inv-liquidos-body");
  const botellasBody = $("inv-botellas-body");
  const capsBody = $("inv-caps-body");
  const variosBody = $("inv-varios-body");
  const variosAdd = $("inv-varios-add");
  const variosSearch = $("inv-varios-search");

  const commitSave = (section, id) => {
    setStatus("Guardando…", "info", { sticky: true });
    const ok = saveInventario(inv);
    if (!ok) {
      setStatus("Error al guardar. Se recargó el inventario.", "error", { sticky: true });
      const fresh = loadInventario();
      inv.liquids = fresh.liquids;
      inv.bottles = fresh.bottles;
      inv.finished = fresh.finished;
      inv.caps = fresh.caps;
      inv.varios = fresh.varios;
      renderLiquidos(inv);
      renderBotellas(inv);
      renderCaps(inv);
      renderVarios(inv);
      renderProductosTerminados(inv);
      applyAllViews();
      return false;
    }
    setStatus("Guardado.", "ok", { timeoutMs: 900 });
    if (section === "liquids") updateLiquidoRow(inv, id);
    if (section === "bottles") updateBottleRow(inv, id);
    if (section === "finished") updateFinishedRow(inv, id);
    if (section === "caps") updateCapRow(inv, id);
    if (section === "varios") renderVarios(inv);
    if (INV_VIEW[section]) applyView(section);
    return true;
  };

  const scheduleSave = debounce((section, id) => commitSave(section, id), 220);

  // Buscador (solo UI, no altera modelo)
  if (variosSearch){
    const applySearch = debounce(() => {
      try{
        INV_VARIOS_UI.search = String(variosSearch.value ?? "");
      }catch(_){ INV_VARIOS_UI.search = ""; }
      renderVarios(inv);
    }, 60);
    variosSearch.addEventListener("input", applySearch);
    variosSearch.addEventListener("keydown", (e) => {
      try{
        if (e && e.key === "Escape"){
          variosSearch.value = "";
          INV_VARIOS_UI.search = "";
          renderVarios(inv);
        }
      }catch(_){ }
    });
  }

  if (liquidosBody) {
    liquidosBody.addEventListener("change", (e) => {
      const target = e.target;
      if (!target.dataset || !target.dataset.kind) return;
      const id = target.dataset.id;
      const kind = target.dataset.kind;

      if (!inv.liquids || !inv.liquids[id]) {
        safeAlert(`Inventario inválido: no existe el ítem "${id}".`);
        updateLiquidoRow(inv, id);
        return;
      }

      if (kind === "liquid-stock") {
        const n = toNonNegativeNumber(target.value);
        if (!Number.isFinite(n)) {
          safeAlert("Cantidad inválida: debe ser un número real >= 0.");
          updateLiquidoRow(inv, id);
          return;
        }
        inv.liquids[id].stock = n;
        updateLiquidoRow(inv, id);
        scheduleSave("liquids", id);
      }

      if (kind === "liquid-max") {
        const n = toNonNegativeNumber(target.value);
        if (!Number.isFinite(n)) {
          safeAlert("Máximo inválido: debe ser un número real >= 0.");
          updateLiquidoRow(inv, id);
          return;
        }
        inv.liquids[id].max = n;
        updateLiquidoRow(inv, id);
        scheduleSave("liquids", id);
      }
    });

    liquidosBody.addEventListener("click", handleAccion);
  }

  if (botellasBody) {
    botellasBody.addEventListener("change", (e) => {
      const target = e.target;
      if (!target.dataset || !target.dataset.kind) return;
      const id = target.dataset.id;
      const kind = target.dataset.kind;

      if (!inv.bottles || !inv.bottles[id]) {
        safeAlert(`Inventario inválido: no existe el ítem "${id}".`);
        updateBottleRow(inv, id);
        return;
      }

      if (kind === "bottle-stock") {
        const n = toNonNegativeInt(target.value);
        if (!Number.isFinite(n)) {
          safeAlert("Cantidad inválida: debe ser un entero >= 0.");
          updateBottleRow(inv, id);
          return;
        }
        inv.bottles[id].stock = n;
        updateBottleRow(inv, id);
        scheduleSave("bottles", id);
      }
    });

    botellasBody.addEventListener("click", handleAccion);
  }

  if (capsBody) {
    capsBody.addEventListener("change", (e) => {
      const target = e.target;
      if (!target.dataset || !target.dataset.kind) return;
      const id = target.dataset.id;
      const kind = target.dataset.kind;

      normalizeCapsSectionInPlace(inv);
      if (!inv.caps || !inv.caps[id]) {
        safeAlert(`Inventario inválido: no existe el ítem "${id}".`);
        updateCapRow(inv, id);
        return;
      }

      if (kind === "cap-stock") {
        const n = toFiniteNumber(target.value);
        if (!Number.isFinite(n) || !Number.isInteger(n)) {
          safeAlert("Cantidad inválida: debe ser un entero (puede ser negativo).");
          updateCapRow(inv, id);
          return;
        }
        inv.caps[id].stock = Math.trunc(n);
        updateCapRow(inv, id);
        scheduleSave("caps", id);
      }

      if (kind === "cap-min") {
        const n = toNonNegativeInt(target.value);
        if (!Number.isFinite(n)) {
          safeAlert("Mínimo inválido: debe ser un entero >= 0.");
          updateCapRow(inv, id);
          return;
        }
        inv.caps[id].min = n;
        updateCapRow(inv, id);
        scheduleSave("caps", id);
      }
    });

    capsBody.addEventListener("click", handleAccion);
  }


  // Inventario Varios: CRUD líneas + semáforo
  const newVariosId = () => {
    const r = Math.floor(Math.random() * 1e6);
    return `v_${Date.now().toString(36)}_${r.toString(36)}`;
  };

  if (variosAdd){
    variosAdd.addEventListener("click", () => {
      try{
        if (!Array.isArray(inv.varios)) inv.varios = [];
        const id = newVariosId();
        inv.varios.push({ id, producto: "", stock: 0, minimo: 0, createdAt: Date.now() });
        normalizeVariosSectionInPlace(inv);
        renderVarios(inv, { focusId: id });
        commitSave("varios", id);
      }catch(e){
        console.error(e);
        safeAlert("No se pudo agregar la línea.");
      }
    });
  }

  // Búsqueda (UI): filtra por producto, en vivo.
  if (variosSearch){
    const applySearch = debounce(() => {
      try{
        INV_VARIOS_UI.search = String(variosSearch.value ?? "");
        renderVarios(inv);
      }catch(_){ }
    }, 60);
    variosSearch.addEventListener("input", applySearch);
    variosSearch.addEventListener("keydown", (e) => {
      if (e && e.key === "Escape"){
        try{
          variosSearch.value = "";
          INV_VARIOS_UI.search = "";
          renderVarios(inv);
          variosSearch.blur();
        }catch(_){ }
      }
    });
  }

  if (variosBody){
    variosBody.addEventListener("change", (e) => {
      const target = e.target;
      if (!target || !target.dataset || !target.dataset.kind) return;
      const kind = target.dataset.kind;
      const id = target.dataset.id;
      if (!id) return;

      if (!Array.isArray(inv.varios)) inv.varios = [];
      const line = inv.varios.find((x) => String(x && x.id) === String(id));
      if (!line){
        safeAlert("Línea no encontrada. Se recargó la vista.");
        renderVarios(inv);
        return;
      }

      if (kind === "varios-producto"){
        line.producto = String(target.value ?? "");
        updateVariosRow(inv, id);
        scheduleSave("varios", id);
        return;
      }

      if (kind === "varios-stock"){
        const n = toFiniteNumber(target.value);
        if (!Number.isFinite(n) || !Number.isInteger(n)){
          safeAlert("Stock inválido: debe ser un entero (puede ser negativo).");
          updateVariosRow(inv, id);
          return;
        }
        line.stock = Math.trunc(n);
        updateVariosRow(inv, id);
        scheduleSave("varios", id);
        return;
      }

      if (kind === "varios-minimo"){
        const n = toNonNegativeInt(target.value);
        if (!Number.isFinite(n)){
          safeAlert("Mínimo inválido: debe ser un entero >= 0." );
          updateVariosRow(inv, id);
          return;
        }
        line.minimo = n;
        updateVariosRow(inv, id);
        scheduleSave("varios", id);
        return;
      }
    });

    variosBody.addEventListener("click", (e) => {
      const target = e.target;
      if (!target || !target.dataset || !target.dataset.action) return;
      const action = target.dataset.action;
      const id = target.dataset.id;
      if (!id) return;

      if (!Array.isArray(inv.varios)) inv.varios = [];

      if (action === "varios-delta"){
        const delta = parseInt(target.dataset.delta || "0", 10);
        if (!Number.isFinite(delta) || delta === 0) return;
        const line = inv.varios.find((x) => String(x && x.id) === String(id));
        if (!line) return;
        const next = (Number.isFinite(line.stock) ? line.stock : 0) + delta;
        line.stock = Math.trunc(next);
        updateVariosRow(inv, id);
        scheduleSave("varios", id);
        return;
      }

      if (action === "varios-delete"){
        const ok = window.confirm("¿Eliminar esta línea?");
        if (!ok) return;
        inv.varios = inv.varios.filter((x) => String(x && x.id) !== String(id));
        normalizeVariosSectionInPlace(inv);
        renderVarios(inv);
        commitSave("varios", id);
        return;
      }
    });
  }

  async function handleAccion(e) {
    const target = e.target;
    if (!target.dataset || !target.dataset.action) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    const kind = target.dataset.kind;

    const etiqueta = kind === "liquid" ? "ml" : "unidades";
    const msg =
      action === "entrada"
        ? `Cantidad de ${etiqueta} para ENTRADA en ${id}:`
        : `Cantidad de ${etiqueta} para SALIDA en ${id}:`;

    let valStr = null;
    if (kind === "liquid") {
      valStr = await openCantidadModal({
        title: "Cantidad (ml)",
        message: msg,
        label: "Cantidad (ml)",
        value: "",
        step: "0.01",
        min: "0",
        mode: "decimal",
      });
      if (valStr == null) return;
    } else if (kind === "bottle" || kind === "cap") {
      valStr = await openCantidadModal({
        title: "Cantidad (unidades)",
        message: msg,
        label: "Cantidad (unidades)",
        value: "",
        step: "1",
        min: "0",
        mode: "numeric",
      });
      if (valStr == null) return;
    } else {
      valStr = window.prompt(msg);
      if (valStr == null) return;
    }

    const cantidad = (kind === "liquid") ? toNonNegativeNumber(valStr) : toNonNegativeInt(valStr);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      // Líquidos: cancelar sin crash.
      if (kind === "liquid") return;
      safeAlert("Cantidad inválida: debe ser > 0 (y entero para botellas/tapas).");
      return;
    }

    if (kind === "liquid") {
      const item = inv.liquids[id] || { stock: 0, max: 0 };
      if (action === "entrada") {
        item.stock = parseNumber(item.stock) + cantidad;
      } else {
        const next = parseNumber(item.stock) - cantidad;
        if (next < 0) {
          safeAlert(`Operación bloqueada: la salida dejaría el stock de ${id} en negativo.`);
          return;
        }
        item.stock = next;
      }
      inv.liquids[id] = item;
      updateLiquidoRow(inv, id);
      commitSave("liquids", id);
      return;
    }

    if (kind === "bottle") {
      const item = inv.bottles[id] || { stock: 0 };
      if (action === "entrada") {
        item.stock = parseNumber(item.stock) + cantidad;
      } else {
        const next = parseNumber(item.stock) - cantidad;
        if (next < 0) {
          safeAlert(`Operación bloqueada: la salida dejaría el stock de ${id} en negativo.`);
          return;
        }
        item.stock = next;
      }
      item.stock = Math.trunc(item.stock);
      inv.bottles[id] = item;
      updateBottleRow(inv, id);
      commitSave("bottles", id);
      return;
    }

    if (kind === "cap") {
      normalizeCapsSectionInPlace(inv);
      const item = (inv.caps && inv.caps[id]) ? inv.caps[id] : { stock: 0, min: 0 };
      if (action === "entrada") {
        item.stock = parseNumber(item.stock) + cantidad;
      } else {
        // permitido negativo
        item.stock = parseNumber(item.stock) - cantidad;
      }
      item.stock = Math.trunc(item.stock);
      if (!inv.caps || typeof inv.caps !== 'object') inv.caps = defaultCapsSection();
      inv.caps[id] = item;
      updateCapRow(inv, id);
      commitSave("caps", id);
      return;
    }
  }
}



function buildAlertLines(inv) {
  const lines = [];

  // Líquidos en alerta (<=20% del máximo definido)
  LIQUIDS.forEach((l) => {
    const info = inv.liquids[l.id] || { stock: 0, max: 0 };
    const stock = parseNumber(info.stock);
    const max = parseNumber(info.max);
    if (max > 0) {
      const pct = (stock / max) * 100;
      if (pct <= 20) {
        lines.push(`• ${l.nombre}: ${stock.toFixed(0)} ml (${pct.toFixed(1)}% restante)`);
      }
    }
  });

  // Botellas en alerta (<=10 unidades)
  BOTTLES.forEach((b) => {
    const info = inv.bottles[b.id] || { stock: 0 };
    const stock = parseNumber(info.stock);
    if (stock <= 10) {
      lines.push(`• ${b.nombre}: ${stock.toFixed(0)} botellas`);
    }
  });

  // Producto terminado en alerta (<=10 unidades)
  FINISHED.forEach((p) => {
    const info = (inv.finished && inv.finished[p.id]) || { stock: 0 };
    const stock = parseNumber(info.stock);
    if (stock <= 10) {
      lines.push(`• ${p.nombre}: ${stock.toFixed(0)} botellas listas`);
    }
  });

  return lines;
}


function calcularEstadoProductoTerminado(item) {
  const stock = parseNumber(item.stock);
  if (stock <= 0) {
    return { label: "Sin stock", className: "status-critical" };
  }
  if (stock <= 10) {
    return { label: `Bajo (${stock} unid.)`, className: "status-warn" };
  }
  return { label: `OK (${stock} unid.)`, className: "status-ok" };
}

function renderProductosTerminados(inv) {
  const tbody = $("inv-productos-body");
  if (!tbody) return;

  FINISHED.forEach((pDef) => {
		ensureFinishedRow(tbody, pDef);
    updateFinishedRow(inv, pDef.id);
  });

  applyView("finished");
}





function installSmokeHooks(inv){
  try{
    if (typeof window === 'undefined') return;
    const api = {
      get: ()=> deepClone(inv),
      getCaps: ()=> deepClone((inv && inv.caps) ? inv.caps : null),
      setCaps: (capId, stock, min)=>{
        try{
          normalizeCapsSectionInPlace(inv);
          if (!inv.caps[capId]) inv.caps[capId] = { stock: 0, min: 0 };
          if (stock != null) inv.caps[capId].stock = toIntSafe(stock, inv.caps[capId].stock);
          if (min != null) inv.caps[capId].min = Math.max(0, toIntSafe(min, inv.caps[capId].min));
          return saveInventario(inv);
        }catch(_){ return false; }
      },
      getVarios: ()=> deepClone(Array.isArray(inv && inv.varios) ? inv.varios : []),
      addVarios: (producto, stock, minimo)=>{
        try{
          if (!Array.isArray(inv.varios)) inv.varios = [];
          const now = Date.now();
          const id = `v_${now}_${Math.floor(Math.random() * 100000)}`;
          inv.varios.push({
            id,
            producto: String(producto ?? '').trim(),
            stock: toIntSafe(stock, 0),
            minimo: Math.max(0, toIntSafe(minimo, 0)),
            createdAt: now,
          });
          normalizeVariosSectionInPlace(inv);
          return saveInventario(inv);
        }catch(_){ return false; }
      },
      setVarios: (id, patch)=>{
        try{
          if (!Array.isArray(inv.varios)) inv.varios = [];
          const pid = String(id || '').trim();
          if (!pid) return false;
          const it = inv.varios.find(x => x && typeof x === 'object' && String(x.id || '').trim() === pid);
          if (!it) return false;
          const p = (patch && typeof patch === 'object') ? patch : {};
          if (p.producto != null) it.producto = String(p.producto ?? '').trim();
          if (p.stock != null) it.stock = toIntSafe(p.stock, it.stock);
          if (p.minimo != null) it.minimo = Math.max(0, toIntSafe(p.minimo, it.minimo));
          normalizeVariosSectionInPlace(inv);
          return saveInventario(inv);
        }catch(_){ return false; }
      },
      delVarios: (id)=>{
        try{
          if (!Array.isArray(inv.varios)) inv.varios = [];
          const pid = String(id || '').trim();
          if (!pid) return false;
          inv.varios = inv.varios.filter(x => !(x && typeof x === 'object' && String(x.id || '').trim() === pid));
          normalizeVariosSectionInPlace(inv);
          return saveInventario(inv);
        }catch(_){ return false; }
      },
      smokeVarios: ()=>{
        try{
          const before = deepClone(Array.isArray(inv.varios) ? inv.varios : []);
          // Insertar 1–2 líneas de prueba y persistir (solo si se llama explícitamente)
          api.addVarios('Vaso (smoke)', 5, 0);
          api.addVarios('Guantes (smoke)', -2, 0);
          const afterSave = deepClone(Array.isArray(inv.varios) ? inv.varios : []);
          const afterReload = api.reload();
          const ok = signatureVarios(afterSave) === signatureVarios(afterReload.varios || []);
          return { ok, before, afterSave, afterReload: deepClone(afterReload.varios || []) };
        }catch(_){ return { ok:false }; }
      },
      reload: ()=>{
        try{
          const fresh = loadInventario();
          inv.liquids = fresh.liquids;
          inv.bottles = fresh.bottles;
          inv.finished = fresh.finished;
          inv.caps = fresh.caps;
          inv.varios = fresh.varios;
          return deepClone(inv);
        }catch(_){ return deepClone(inv); }
      }
    };
    try{
      Object.defineProperty(window, '__A33_INV_SMOKE', { value: api, configurable: true });
    }catch(_){
      window.__A33_INV_SMOKE = api;
    }
  }catch(_){ }
}



function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js?v=4.20.77&r=1")
      .catch((err) => console.error("SW error", err));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setStatus("Cargando…", "info", { sticky: true });

  const inv = loadInventario();
  installSmokeHooks(inv);

  renderLiquidos(inv);
  renderBotellas(inv);
  renderCaps(inv);
  renderVarios(inv);
  renderProductosTerminados(inv);

  wireViewControls();
  attachListeners(inv);
  applyAllViews();
  // Si no hubo alertas, dejar señal corta de listo
  const statusEl = $("inv-status");
  if (statusEl && !statusEl.textContent) {
    setStatus("Listo.", "ok", { timeoutMs: 900 });
  }

  registerServiceWorker();
});

