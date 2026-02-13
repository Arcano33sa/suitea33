// Simple storage using localStorage
const STORAGE_KEY = "arcano33_lotes";
const ARCHIVE_KEY = "arcano33_lotes_archived"; // Histórico (Etapa 5)

let editingId = null;
let isSavingLote = false;
let editingCtx = null; // { id, metaRev, metaUpdatedAt, fingerprint }

// Abreviaturas para compactar columnas (UI) sin tocar datos
const PROD_ABBR = {
  Pulso: "P",
  Media: "M",
  Djeba: "D",
  Litro: "L",
  "Galón": "G",
  Galon: "G",
};

// Etapa 2: Totales (RESTANTE) por presentación
const TOTAL_KEYS = ["P", "M", "D", "L", "G"];

// --- Identidad estable + anti-duplicados (Etapa 1)
function canonicalBatchCode(code){
  // Canónico: trim + upper + sin espacios (conservador: NO tocar otros caracteres)
  return (code ?? '').toString().trim().toUpperCase().replace(/\s+/g, '');
}

function stableHash32(str){
  // djb2 (simple, determinístico) -> hex
  let h = 5381;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++){
    h = ((h << 5) + h) + s.charCodeAt(i);
    h >>>= 0;
  }
  return h.toString(16);
}

function deriveStableLoteId(lote){
  const bc = canonicalBatchCode(lote?.codigo || lote?.batchCode || lote?.code);
  if (bc) return `batch_${bc}`;

  // Fallback determinístico si no hay código
  const base = JSON.stringify({
    codigo: (lote?.codigo || ''),
    fecha: (lote?.fecha || ''),
    createdAt: (lote?.createdAt || ''),
    volTotal: (lote?.volTotal || ''),
    pulso: (lote?.pulso ?? ''),
    media: (lote?.media ?? ''),
    djeba: (lote?.djeba ?? ''),
    litro: (lote?.litro ?? ''),
    galon: (lote?.galon ?? ''),
  });
  return `lote_${stableHash32(base)}`;
}

function backfillLoteIdentityInPlace(lote){
  if (!lote || typeof lote !== 'object') return false;
  let changed = false;

  if (!lote.loteId){
    lote.loteId = lote.id || deriveStableLoteId(lote);
    changed = true;
  }
  if (!lote.id){
    // Compat: el resto del módulo edita por lote.id
    lote.id = lote.loteId;
    changed = true;
  }

  const bc = canonicalBatchCode(lote.codigo);
  if (bc && lote.batchCode !== bc){
    lote.batchCode = bc;
    changed = true;
  }

  return changed;
}

function backfillLotesIdentityIfNeeded(lotes){
  if (!Array.isArray(lotes) || !lotes.length) return { lotes, changed: false };
  let changed = false;
  for (const l of lotes){
    if (backfillLoteIdentityInPlace(l)) changed = true;
  }
  return { lotes, changed };
}

function getCanonicalRemainingByKey(lote){
  // Fuente de verdad: lote.eventUsage[eventId].remainingByKey (o equivalente)
  const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : "";
  if (!eid) return null;
  const eu = (lote && typeof lote.eventUsage === 'object' && !Array.isArray(lote.eventUsage)) ? lote.eventUsage : null;
  if (!eu) return null;
  const snap = eu[eid];
  if (!snap || typeof snap !== 'object') return null;
  const rbk = snap.remainingByKey;
  if (!rbk || typeof rbk !== 'object' || Array.isArray(rbk)) return null;
  return rbk;
}

function computeRemainingTotals(visibleLotes){
  const totals = { P: 0, M: 0, D: 0, L: 0, G: 0 };
  if (!Array.isArray(visibleLotes) || !visibleLotes.length) return totals;

  for (const lote of visibleLotes){
    const rbk = getCanonicalRemainingByKey(lote);
    if (!rbk) continue; // si no hay snapshot confiable, no aporta (no inventar)
    for (const k of TOTAL_KEYS){
      const v = Number(rbk[k]);
      if (Number.isFinite(v) && v >= 0) totals[k] += v;
    }
  }
  return totals;
}

function updateTotalsBarUI(totals){
  const bar = $("totals-bar");
  if (!bar) return;

  for (const k of TOTAL_KEYS){
    const el = bar.querySelector(`[data-total-key="${k}"]`);
    if (!el) continue;
    const n = Number(totals && totals[k]);
    const v = Number.isFinite(n) ? n : 0;
    el.textContent = String(v);
    el.classList.toggle('is-zero', v === 0);
  }
}

function abbrProducto(nombre) {
  if (!nombre) return "";
  return PROD_ABBR[nombre] || nombre.trim().charAt(0).toUpperCase();
}

function $(id) {
  return document.getElementById(id);
}

// ================================
// Etapa 3: iPad-first + rendimiento
// - búsqueda con debounce
// - paginación simple (cargar más)
// - menos listeners (delegación)
// ================================

const LIST_PAGE_SIZE = 60;

let listView = {
  query: '',
  pageSize: LIST_PAGE_SIZE,
  wanted: LIST_PAGE_SIZE,
  rendered: 0,
  metaRev: null,
  allSorted: [],
  filtered: [],
  byId: new Map(),
  searchIndex: new Map(),
  totals: { P: 0, M: 0, D: 0, L: 0, G: 0 },
};

let isExporting = false;

function debounce(fn, delayMs){
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delayMs);
  };
}

function setExportHint(msg, isError){
  const el = $("export-hint");
  if (!el) return;
  el.textContent = msg ? String(msg) : "";
  el.classList.toggle('is-error', !!isError);
}


function isCardMode(){
  try{
    return window.matchMedia && window.matchMedia('(max-width: 1024px)').matches;
  }catch(_){
    return false;
  }
}

// ================================
// Etapa 2: Compatibilidad total + lectura robusta
// - tolera data vieja / variantes de otros módulos
// - normaliza fechas (YYYY-MM-DD) y números
// ================================

function normStr(v){
  if (v == null) return '';
  return String(v);
}

function isBlank(v){
  return v == null || (typeof v === 'string' && v.trim() === '');
}

function normalizeDateYMD(value){
  if (!value) return '';
  // Si ya es YYYY-MM-DD, respetar
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try{
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0,10);
  }catch(_){
    return '';
  }
}

function coerceNonNegIntString(value, fallback='0'){
  if (value == null) return fallback;
  const n = parseInt(String(value).replace(/[^0-9-]/g,''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return String(n);
}

function coerceFiniteNumberString(value, fallback=''){
  if (value == null) return fallback;
  const s = String(value).trim();
  if (!s) return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  // Mantener entero sin .0, pero no forzar decimales.
  return String(n % 1 === 0 ? Math.trunc(n) : n);
}

function normalizeLoteRecord(lote){
  if (!lote || typeof lote !== 'object') return null;
  const out = { ...lote };

  // Variantes comunes de otros módulos
  if (isBlank(out.codigo) && !isBlank(out.batchCode)) out.codigo = normStr(out.batchCode).trim();
  if (isBlank(out.codigo) && !isBlank(out.code)) out.codigo = normStr(out.code).trim();

  // Identidad estable (Etapa 1)
  try{ backfillLoteIdentityInPlace(out); }catch(_){ }

  // Fechas
  const fecha = normalizeDateYMD(out.fecha || out.fechaProd || out.fechaProduccion || out.createdAt);
  if (fecha) out.fecha = fecha;
  const cad = normalizeDateYMD(out.caducidad || out.exp || out.expiryDate);
  if (cad) out.caducidad = cad;
  if (!out.caducidad && out.fecha){
    out.caducidad = calculateCaducidad(out.fecha) || '';
  }

  // Números (conservador: no inventar, solo sanear)
  out.pulso = coerceNonNegIntString(out.pulso, '0');
  out.media = coerceNonNegIntString(out.media, '0');
  out.djeba = coerceNonNegIntString(out.djeba, '0');
  out.litro = coerceNonNegIntString(out.litro, '0');
  // tolerar 'galón' legacy
  if (out.galon == null && out['galón'] != null) out.galon = out['galón'];
  out.galon = coerceNonNegIntString(out.galon, '0');

  out.volTotal = coerceFiniteNumberString(out.volTotal, out.volTotal == null ? '' : '');
  out.volVino = coerceFiniteNumberString(out.volVino, out.volVino == null ? '' : '');
  out.volVodka = coerceFiniteNumberString(out.volVodka, out.volVodka == null ? '' : '');
  out.volJugo = coerceFiniteNumberString(out.volJugo, out.volJugo == null ? '' : '');
  out.volSirope = coerceFiniteNumberString(out.volSirope, out.volSirope == null ? '' : '');
  out.volAgua = coerceFiniteNumberString(out.volAgua, out.volAgua == null ? '' : '');

  // Aceptar totalVolumenFinalMl (Calculadora/inventario) como volTotal si faltaba
  if (isBlank(out.volTotal) && out.totalVolumenFinalMl != null){
    const n = Number(out.totalVolumenFinalMl);
    if (Number.isFinite(n) && n >= 0) out.volTotal = String(Math.round(n));
  }

  // Notas
  if (out.notas != null) out.notas = String(out.notas);

  return out;
}

function normalizeLotesArray(arr){
  const safe = Array.isArray(arr) ? arr : [];
  const out = [];
  for (const it of safe){
    const n = normalizeLoteRecord(it);
    if (n) out.push(n);
  }
  return out;
}

function readLotesAndMetaFresh(){
  try{
    if (window.A33Storage && typeof A33Storage.sharedRead === 'function'){
      const r = A33Storage.sharedRead(STORAGE_KEY, [], 'local');
      const data = normalizeLotesArray(r && r.data);
      return { lotes: data, meta: r && r.meta ? r.meta : A33Storage.sharedGetMeta(STORAGE_KEY, 'local') };
    }
  }catch(_){ }
  // Fallback
  let lotes = [];
  try{
    const raw = A33Storage.getItem(STORAGE_KEY);
    if (raw) lotes = JSON.parse(raw) || [];
  }catch(_){ lotes = []; }
  return { lotes: normalizeLotesArray(lotes), meta: { rev: 0, updatedAt: null, writer: '' } };
}

function nonEditableFingerprint(lote){
  if (!lote || typeof lote !== 'object') return '';
  // Solo campos que NO vienen del formulario (para detectar pisadas reales)
  const pick = {
    loteId: lote.loteId || null,
    status: lote.status || null,
    assignedEventId: lote.assignedEventId ?? null,
    assignedEventName: lote.assignedEventName || null,
    assignedAt: lote.assignedAt || null,
    assignedCargaId: lote.assignedCargaId || null,
    assignmentHistory: lote.assignmentHistory || null,
    eventUsage: lote.eventUsage || null,
    closedAt: lote.closedAt || null,
    reversedAt: lote.reversedAt || null,
    reversedReason: lote.reversedReason || null,
    parentLotId: lote.parentLotId || null,
    loteType: lote.loteType || null,
    sourceEventId: lote.sourceEventId || null,
    sourceEventName: lote.sourceEventName || null,
    recetaId: lote.recetaId || lote.recipeId || null,
    recetaNombre: lote.recetaNombre || lote.recipeName || null,
    inventarioRef: lote.inventarioRef || null,
    extraRefs: lote.refs || null,
  };
  try{ return stableHash32(JSON.stringify(pick)); }catch(_){ return ''; }
}

function loadLotes() {
  try {
    // Lectura robusta (Etapa 2): normaliza sin romper data vieja.
    return readLotesAndMetaFresh().lotes;
  } catch (e) {
    console.error("Error leyendo localStorage", e);
    return [];
  }
}

function loadArchivedLotes(){
  try {
    const raw = A33Storage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    console.error("Error leyendo histórico", e);
    return [];
  }
}

function saveArchivedLotes(data){
  A33Storage.setItem(ARCHIVE_KEY, JSON.stringify(data));
}

function saveLotes(data) {
  try {
    if (window.A33Storage && typeof A33Storage.sharedSet === 'function') {
      const r = A33Storage.sharedSet(STORAGE_KEY, data, { source: 'lotes' });
      if (r && r.ok === false) {
        if (r.message) alert(r.message);
        return false;
      }
      return true;
    }
  } catch (e) {
    console.warn('saveLotes (shared) falló, usando fallback:', e);
  }
  try {
    const ok = A33Storage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (!ok) {
      alert('No se pudo guardar el lote. Revisa espacio disponible o permisos del navegador.');
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error guardando lotes (fallback)', e);
    alert('No se pudo guardar el lote.');
    return false;
  }
}

function formatDate(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toISOString().slice(0, 10);
  } catch {
    return value;
  }
}

function calculateCaducidad(fechaStr) {
  if (!fechaStr) return "";
  const d = new Date(fechaStr);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  const cad = new Date(year, month + 2, day);
  return cad.toISOString().slice(0, 10);
}

// Helpers para ordenar (más reciente arriba)
function toTimestamp(value) {
  if (!value) return NaN;
  const d = new Date(value);
  const t = d.getTime();
  return Number.isFinite(t) ? t : NaN;
}

function getCreatedTimestamp(lote) {
  // Preferir createdAt si existe
  const tCreated = toTimestamp(lote?.createdAt);
  if (Number.isFinite(tCreated)) return tCreated;

  // Fallback: id con timestamp (lote_1734567890123)
  if (typeof lote?.id === "string" && lote.id.startsWith("lote_")) {
    const n = Number(lote.id.slice(5));
    if (Number.isFinite(n)) return n;
  }

  // Fallback final: fecha de elaboración
  const tFecha = toTimestamp(lote?.fecha);
  if (Number.isFinite(tFecha)) return tFecha;

  return 0;
}

function formatDateTime(value){
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('es-NI');
  } catch {
    return String(value);
  }
}

function buildArchiveSnapshot(lote, deletedAtIso){
  const deletedAt = deletedAtIso || new Date().toISOString();
  const createdAt = lote?.createdAt || (() => {
    const t = getCreatedTimestamp(lote);
    try { return new Date(t || Date.now()).toISOString(); } catch { return ""; }
  })();

  const st = effectiveLoteStatus(lote);
  const sem = st === "EN_EVENTO" ? getLoteSemaforoState(lote) : "";
  const assignedEventId = lote?.assignedEventId != null ? String(lote.assignedEventId).trim() : "";
  const assignedEventName = (lote?.assignedEventName || "").toString().trim();

  // Guardar SOLO el snapshot del evento asignado si existe; si no, no inventar.
  let eventUsageSnap = null;
  if (assignedEventId && lote && typeof lote.eventUsage === 'object' && !Array.isArray(lote.eventUsage)){
    const snap = lote.eventUsage[assignedEventId];
    if (snap && typeof snap === 'object'){
      eventUsageSnap = { [assignedEventId]: snap };
    }
  }

  return {
    archiveId: `arch_${Date.now()}_${String(lote?.id || '')}`,
    originalId: lote?.id,
    codigo: (lote?.codigo || "").toString(),
    createdAt,
    deletedAt,
    statusAtDelete: st,
    semaforoAtDelete: sem,
    // "producto/presentación" => aquí guardamos presentaciones (unidades) + volTotal como resumen
    volTotal: lote?.volTotal ?? "",
    pulso: lote?.pulso ?? "0",
    media: lote?.media ?? "0",
    djeba: lote?.djeba ?? "0",
    litro: lote?.litro ?? "0",
    galon: lote?.galon ?? "0",
    assignedEventId: assignedEventId || null,
    assignedEventName: assignedEventName || "",
    eventUsage: eventUsageSnap,
  };
}

function archiveLote(lote, deletedAtIso){
  const snapshot = buildArchiveSnapshot(lote, deletedAtIso);
  const hist = loadArchivedLotes();
  hist.unshift(snapshot);
  saveArchivedLotes(hist);
  return snapshot;
}


// --- Estado/asignaci�n de lotes (compat: lotes viejos = DISPONIBLE)
function normLoteStatus(status){
  const s = (status || "").toString().trim().toUpperCase();
  if (!s) return "";
  if (s === "EN EVENTO") return "EN_EVENTO";
  if (s === "EN_EVENTO") return "EN_EVENTO";
  if (s === "DISPONIBLE") return "DISPONIBLE";
  if (s === "CERRADO") return "CERRADO";
  return s;
}

function effectiveLoteStatus(lote){
  const st = normLoteStatus(lote?.status);
  const assigned = lote?.assignedEventId != null && String(lote.assignedEventId).trim() !== "";
  if (st === "CERRADO") return "CERRADO";
  if (assigned) return "EN_EVENTO";
  if (st === "EN_EVENTO") return "EN_EVENTO";
  return "DISPONIBLE";
}

// Semáforo PARCIAL / VENDIDO (solo EN EVENTO)
// Fuente canónica: lote.eventUsage[eventId].remainingTotal
function getLoteSemaforoState(lote){
  // Conservador: si falta data, PARCIAL.
  const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : "";
  if (!eid) return "PARCIAL";
  const eu = (lote && typeof lote.eventUsage === 'object' && !Array.isArray(lote.eventUsage)) ? lote.eventUsage : null;
  if (!eu) return "PARCIAL";
  const snap = eu[eid];
  if (!snap || typeof snap !== 'object') return "PARCIAL";
  const remainingTotal = Number(snap.remainingTotal);
  if (Number.isFinite(remainingTotal) && remainingTotal === 0) return "VENDIDO";
  return "PARCIAL";
}

function showLoteDetails(lote) {
  const lines = [];
  const st = effectiveLoteStatus(lote);
  lines.push(`Lote: ${lote.codigo || ""}`);
  lines.push(`Estado: ${st}`);

  const evName = (lote.assignedEventName || "").toString().trim();
  if (evName) lines.push(`Evento asignado: ${evName}`);

  if (lote.closedAt) {
    try {
      const d = new Date(lote.closedAt);
      lines.push(`Cerrado: ${Number.isNaN(d.getTime()) ? lote.closedAt : d.toLocaleString('es-NI')}`);
    } catch {
      lines.push(`Cerrado: ${lote.closedAt}`);
    }
  }

  // Reverso de asignación (airbag anti-errores)
  if (lote.reversedAt) {
    try {
      const d = new Date(lote.reversedAt);
      lines.push(`Reversado: ${Number.isNaN(d.getTime()) ? lote.reversedAt : d.toLocaleString('es-NI')}`);
    } catch {
      lines.push(`Reversado: ${lote.reversedAt}`);
    }
    const rr = (lote.reversedReason || '').toString().trim();
    if (rr) lines.push(`Motivo: ${rr}`);
  }

  // Trazabilidad (lote hijo / sobrante)
  const parentId = (lote.parentLotId || "").toString().trim();
  if (parentId) {
    const all = loadLotes();
    const parent = all.find(l => l && String(l.id) === parentId) || null;
    const pcode = parent ? (parent.codigo || parent.name || parent.nombre || parentId) : parentId;
    lines.push(`Sobrante de: ${pcode}`);
  }
  const srcEv = (lote.sourceEventName || lote.sourceEventId || "").toString().trim();
  if (srcEv) lines.push(`Evento origen: ${srcEv}`);

  lines.push("");
  lines.push(`Fecha de elaboración: ${formatDate(lote.fecha)}`);
  lines.push(`Fecha de caducidad: ${formatDate(lote.caducidad)}`);
  lines.push("");
  lines.push("Volúmenes (ml):");
  lines.push(`  Total: ${lote.volTotal || "0"}`);
  lines.push(`  Vino: ${lote.volVino || "0"}`);
  lines.push(`  Vodka: ${lote.volVodka || "0"}`);
  lines.push(`  Jugo: ${lote.volJugo || "0"}`);
  lines.push(`  Sirope: ${lote.volSirope || "0"}`);
  lines.push(`  Agua: ${lote.volAgua || "0"}`);
  lines.push("");
  lines.push("Unidades por presentación:");
  lines.push(`  Pulso 250 ml: ${lote.pulso ?? "0"}`);
  lines.push(`  Media 375 ml: ${lote.media ?? "0"}`);
  lines.push(`  Djeba 750 ml: ${lote.djeba ?? "0"}`);
  lines.push(`  Litro 1000 ml: ${lote.litro ?? "0"}`);
  lines.push(`  Galón 3750 ml: ${lote.galon ?? "0"}`);
  if (lote.notas) {
    lines.push("");
    lines.push("Notas:");
    lines.push(lote.notas);
  }
  alert(lines.join("\n"));
}

function clearForm() {
  const form = $("lote-form");
  form.reset();
  // Restaurar valores por defecto numéricos
  ["pulso", "media", "djeba", "litro", "galon"].forEach((id) => {
    const el = $(id);
    if (el) el.value = "0";
  });

  const today = new Date().toISOString().slice(0, 10);
  $("fecha").value = today;
  $("caducidad").value = calculateCaducidad(today);
  editingId = null;
  editingCtx = null;
  $("save-btn").textContent = "Guardar lote";
}

function readFormData() {
  const fecha = $("fecha").value;
  const codigo = $("codigo").value.trim();
  const batchCode = canonicalBatchCode(codigo);

  if (!fecha || !codigo) {
    alert("Fecha y código de lote son obligatorios.");
    return null;
  }

  const data = {
    id: editingId || `lote_${Date.now()}`,
    // Identidad estable (nuevo) + canónico para dedupe
    loteId: editingId ? undefined : (batchCode ? `batch_${batchCode}` : undefined),
    batchCode: batchCode || undefined,
    fecha: formatDate(fecha),
    codigo,
    caducidad: $("caducidad").value || calculateCaducidad(fecha),

    volTotal: $("volTotal").value || "",
    volVino: $("volVino").value || "",
    volVodka: $("volVodka").value || "",
    volJugo: $("volJugo").value || "",
    volSirope: $("volSirope").value || "",
    volAgua: $("volAgua").value || "",

    pulso: $("pulso").value || "0",
    media: $("media").value || "0",
    djeba: $("djeba").value || "0",
    litro: $("litro").value || "0",
    galon: $("galon").value || "0",

    notas: $("notas").value.trim(),
  };

  // Estado inicial (compatibilidad). Solo para lotes nuevos.
  if (!editingId){
    data.status = "DISPONIBLE";
    data.assignedEventId = null;
    data.assignedEventName = "";
    data.assignedAt = null;
  }

  // Mantener createdAt estable (no borrarlo al editar). Agregamos updatedAt opcional.
  if (!editingId) {
    data.createdAt = new Date().toISOString();
  } else {
    data.updatedAt = new Date().toISOString();
  }

  return data;
}

function populateForm(lote) {
  $("fecha").value = formatDate(lote.fecha);
  $("codigo").value = lote.codigo || "";
  $("caducidad").value = formatDate(lote.caducidad);

  $("volTotal").value = lote.volTotal || "";
  $("volVino").value = lote.volVino || "";
  $("volVodka").value = lote.volVodka || "";
  $("volJugo").value = lote.volJugo || "";
  $("volSirope").value = lote.volSirope || "";
  $("volAgua").value = lote.volAgua || "";

  $("pulso").value = lote.pulso ?? "0";
  $("media").value = lote.media ?? "0";
  $("djeba").value = lote.djeba ?? "0";
  $("litro").value = lote.litro ?? "0";
  $("galon").value = lote.galon ?? "0";

  $("notas").value = lote.notas || "";

  editingId = lote.id;
  // Contexto de edición (Etapa 2): detectar cambios externos del MISMO lote
  try {
    const { meta } = readLotesAndMetaFresh();
    editingCtx = {
      id: String(lote.id),
      metaRev: meta && typeof meta.rev === 'number' ? meta.rev : 0,
      metaUpdatedAt: meta && meta.updatedAt ? String(meta.updatedAt) : null,
      fingerprint: nonEditableFingerprint(lote)
    };
  } catch (_){
    editingCtx = { id: String(lote.id), metaRev: 0, metaUpdatedAt: null, fingerprint: nonEditableFingerprint(lote) };
  }
  $("save-btn").textContent = "Actualizar lote";
}

function buildLoteRow(lote){
  const tr = document.createElement("tr");

  // Estado y snapshot canónico por evento (para doble línea: Creado + Parcial/restante)
  const st = effectiveLoteStatus(lote);
  const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : "";
  const sem = st === "EN_EVENTO" ? getLoteSemaforoState(lote) : "";
  const eu = (lote && typeof lote.eventUsage === "object" && !Array.isArray(lote.eventUsage)) ? lote.eventUsage : null;
  const snap = (eu && eid) ? eu[eid] : null;
  const remainingByKey = (snap && typeof snap === "object" && snap.remainingByKey && typeof snap.remainingByKey === "object") ? snap.remainingByKey : null;
  const showRemainingLine = (st === "EN_EVENTO" && sem === "PARCIAL" && !!remainingByKey);

  const labels = ["Fecha","Código","Vol. ML","P","M","D","L","G","Caducidad"];

  const fields = [
    formatDate(lote.fecha),
    lote.codigo || "",
    lote.volTotal || "",
    lote.pulso ?? "",
    lote.media ?? "",
    lote.djeba ?? "",
    lote.litro ?? "",
    lote.galon ?? "",
    formatDate(lote.caducidad),
  ];

  fields.forEach((value, idx) => {
    const td = document.createElement("td");
    td.setAttribute('data-label', labels[idx] || '');

    // idx: 0 Fecha, 1 Código, 2 VolTotal, 3 Pulso, 4 Media, 5 Djeba, 6 Litro, 7 Galón, 8 Caducidad
    if (idx === 1) {
      td.classList.add("lote-codecell");

      const codeText = document.createElement("div");
      codeText.className = "lote-code-text";
      codeText.textContent = value;
      td.appendChild(codeText);

      const line = document.createElement("div");
      line.className = "lote-status-line";

      const stChip = document.createElement("span");
      stChip.className =
        "chip " +
        (st === "DISPONIBLE"
          ? "chip--available"
          : st === "EN_EVENTO"
          ? "chip--in-event"
          : "chip--closed");
      stChip.textContent = st === "EN_EVENTO" ? "EN EVENTO" : st;
      line.appendChild(stChip);

      // Semáforo de consumo por evento: PARCIAL / VENDIDO
      if (st === "EN_EVENTO") {
        if (showRemainingLine) {
          const br = document.createElement("span");
          br.className = "chip-break";
          br.setAttribute("aria-hidden", "true");
          line.appendChild(br);
        }

        const semChip = document.createElement("span");
        semChip.className = "chip " + (sem === "VENDIDO" ? "chip--sold" : "chip--partial");
        semChip.textContent = sem;
        line.appendChild(semChip);
      }

      // Lote hijo / SOBRANTE (trazabilidad)
      const isChild = !!lote.parentLotId || String(lote.loteType || '').trim().toUpperCase() === 'SOBRANTE';
      if (isChild){
        const childChip = document.createElement('span');
        childChip.className = 'chip chip--child';
        childChip.textContent = String(lote.loteType || '').trim().toUpperCase() === 'SOBRANTE' ? 'SOBRANTE' : 'HIJO';
        line.appendChild(childChip);

        const pid = (lote.parentLotId || '').toString().trim();
        if (pid){
          const p = listView.byId.get(pid) || null;
          const pcode = p ? (p.codigo || p.name || p.nombre || pid).toString() : pid;
          const parentChip = document.createElement('span');
          parentChip.className = 'chip chip--parent';
          parentChip.textContent = 'De: ' + pcode;
          parentChip.title = 'De: ' + pcode;
          line.appendChild(parentChip);
        }
      }

      if (st === "EN_EVENTO" || st === "CERRADO") {
        const evName = (lote.assignedEventName || "").toString().trim();
        if (evName) {
          const evChip = document.createElement("span");
          evChip.className = "chip chip--event";
          evChip.textContent = "Evento: " + evName;
          evChip.title = evName;
          line.appendChild(evChip);
        }
      }

      td.appendChild(line);
      tr.appendChild(td);
      return;
    }

    // Columnas de presentaciones: doble línea cuando el lote está PARCIAL y existe snapshot
    if (idx >= 3 && idx <= 7 && showRemainingLine) {
      const k = ["P", "M", "D", "L", "G"][idx - 3];
      const createdSpan = document.createElement("span");
      createdSpan.textContent = String(value ?? "");

      const remVal = (remainingByKey && Object.prototype.hasOwnProperty.call(remainingByKey, k))
        ? remainingByKey[k]
        : 0;
      const remainingSpan = document.createElement("span");
      remainingSpan.className = "qty-remaining";
      remainingSpan.textContent = String(remVal ?? "0");

      const stack = document.createElement("div");
      stack.className = "qty-stack";
      stack.appendChild(createdSpan);
      stack.appendChild(remainingSpan);

      td.appendChild(stack);
    } else if (idx === 8) {
      // caducidad: mostrar fecha + badge si vencido
      const dateStr = String(value ?? '');
      const dateSpan = document.createElement('span');
      dateSpan.textContent = dateStr;
      td.appendChild(dateSpan);

      if (dateStr) {
        const today = new Date().toISOString().slice(0, 10);
        if (dateStr < today) {
          const b = document.createElement('span');
          b.className = 'badge';
          b.style.marginLeft = '6px';
          b.textContent = 'Vencido';
          td.appendChild(b);
        }
      }
    } else {
      td.textContent = value;
    }

    if (idx >= 3 && idx <= 7) td.classList.add("col-producto-abbr");

    tr.appendChild(td);
  });

  const actionsTd = document.createElement("td");
  actionsTd.className = "actions-cell";
  actionsTd.setAttribute('data-label', 'Acciones');

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "acciones";

  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.textContent = "👁";
  viewBtn.title = "Ver";
  viewBtn.setAttribute("aria-label", "Ver");
  viewBtn.className = "btn icon";
  viewBtn.dataset.action = 'view';
  viewBtn.dataset.id = String(lote.id);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.textContent = "✎";
  editBtn.title = "Editar";
  editBtn.setAttribute("aria-label", "Editar");
  editBtn.className = "btn secondary icon";
  editBtn.dataset.action = 'edit';
  editBtn.dataset.id = String(lote.id);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "🗑";
  deleteBtn.title = "Borrar";
  deleteBtn.setAttribute("aria-label", "Borrar");
  deleteBtn.className = "btn danger icon";
  deleteBtn.dataset.action = 'delete';
  deleteBtn.dataset.id = String(lote.id);

  actionsWrap.appendChild(viewBtn);
  actionsWrap.appendChild(editBtn);
  actionsWrap.appendChild(deleteBtn);

  actionsTd.appendChild(actionsWrap);
  tr.appendChild(actionsTd);

  return tr;
}

function buildLoteCard(lote){
  const card = document.createElement('div');
  card.className = 'lote-card';
  card.setAttribute('role','listitem');

  const st = effectiveLoteStatus(lote);
  const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : '';
  const sem = st === 'EN_EVENTO' ? getLoteSemaforoState(lote) : '';
  const eu = (lote && typeof lote.eventUsage === 'object' && !Array.isArray(lote.eventUsage)) ? lote.eventUsage : null;
  const snap = (eu && eid) ? eu[eid] : null;
  const remainingByKey = (snap && typeof snap === 'object' && snap.remainingByKey && typeof snap.remainingByKey === 'object') ? snap.remainingByKey : null;
  const showRemainingLine = (st === 'EN_EVENTO' && sem === 'PARCIAL' && !!remainingByKey);

  const head = document.createElement('div');
  head.className = 'lote-card-head';

  const dateEl = document.createElement('div');
  dateEl.className = 'lote-card-date';
  dateEl.textContent = formatDate(lote.fecha);

  const codeEl = document.createElement('div');
  codeEl.className = 'lote-card-code';
  codeEl.textContent = (lote.codigo || '').toString();
  codeEl.title = codeEl.textContent;

  head.appendChild(dateEl);
  head.appendChild(codeEl);
  card.appendChild(head);

  // Chips de estado/evento
  const line = document.createElement('div');
  line.className = 'lote-status-line';

  const stChip = document.createElement('span');
  stChip.className = 'chip ' + (st === 'DISPONIBLE' ? 'chip--available' : st === 'EN_EVENTO' ? 'chip--in-event' : 'chip--closed');
  stChip.textContent = st === 'EN_EVENTO' ? 'EN EVENTO' : st;
  line.appendChild(stChip);

  if (st === 'EN_EVENTO'){
    if (showRemainingLine){
      const br = document.createElement('span');
      br.className = 'chip-break';
      br.setAttribute('aria-hidden','true');
      line.appendChild(br);
    }
    const semChip = document.createElement('span');
    semChip.className = 'chip ' + (sem === 'VENDIDO' ? 'chip--sold' : 'chip--partial');
    semChip.textContent = sem;
    line.appendChild(semChip);
  }

  // Lote hijo / SOBRANTE
  const isChild = !!lote.parentLotId || String(lote.loteType || '').trim().toUpperCase() === 'SOBRANTE';
  if (isChild){
    const childChip = document.createElement('span');
    childChip.className = 'chip chip--child';
    childChip.textContent = String(lote.loteType || '').trim().toUpperCase() === 'SOBRANTE' ? 'SOBRANTE' : 'HIJO';
    line.appendChild(childChip);

    const pid = (lote.parentLotId || '').toString().trim();
    if (pid){
      const p = listView.byId.get(pid) || null;
      const pcode = p ? (p.codigo || p.name || p.nombre || pid).toString() : pid;
      const parentChip = document.createElement('span');
      parentChip.className = 'chip chip--parent';
      parentChip.textContent = 'De: ' + pcode;
      parentChip.title = 'De: ' + pcode;
      line.appendChild(parentChip);
    }
  }

  if (st === 'EN_EVENTO' || st === 'CERRADO'){
    const evName = (lote.assignedEventName || '').toString().trim();
    if (evName){
      const evChip = document.createElement('span');
      evChip.className = 'chip chip--event';
      evChip.textContent = 'Evento: ' + evName;
      evChip.title = evName;
      line.appendChild(evChip);
    }
  }

  card.appendChild(line);

  // Mini grid
  const grid = document.createElement('div');
  grid.className = 'lote-card-grid';

  const mk = (key, valNodeOrText) => {
    const box = document.createElement('div');
    box.className = 'mini-kpi';
    const k = document.createElement('div');
    k.className = 'mini-kpi-key';
    k.textContent = String(key);
    const v = document.createElement('div');
    v.className = 'mini-kpi-val';
    if (valNodeOrText && typeof valNodeOrText === 'object' && valNodeOrText.nodeType){
      v.appendChild(valNodeOrText);
    } else {
      v.textContent = String(valNodeOrText ?? '');
    }
    box.appendChild(k);
    box.appendChild(v);
    return box;
  };

  const qtyStack = (created, remaining) => {
    const stack = document.createElement('div');
    stack.className = 'qty-stack';
    const a = document.createElement('span');
    a.textContent = String(created ?? '');
    stack.appendChild(a);
    if (remaining != null){
      const b = document.createElement('span');
      b.className = 'qty-remaining';
      b.textContent = String(remaining ?? '0');
      stack.appendChild(b);
    }
    return stack;
  };

  grid.appendChild(mk('Vol', String(lote.volTotal || '')));

  const keys = ['P','M','D','L','G'];
  const vals = [lote.pulso, lote.media, lote.djeba, lote.litro, lote.galon];
  for (let i=0;i<keys.length;i++){
    if (showRemainingLine){
      const rem = (remainingByKey && Object.prototype.hasOwnProperty.call(remainingByKey, keys[i])) ? remainingByKey[keys[i]] : 0;
      grid.appendChild(mk(keys[i], qtyStack(vals[i] ?? '', rem)));
    } else {
      grid.appendChild(mk(keys[i], String(vals[i] ?? '')));
    }
  }

  const cadStr = formatDate(lote.caducidad);
  const cadWrap = document.createElement('div');
  cadWrap.style.display = 'inline-flex';
  cadWrap.style.alignItems = 'center';
  cadWrap.style.gap = '6px';
  const cadTxt = document.createElement('span');
  cadTxt.textContent = cadStr;
  cadWrap.appendChild(cadTxt);
  if (cadStr){
    const today = new Date().toISOString().slice(0,10);
    if (cadStr < today){
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'Vencido';
      cadWrap.appendChild(b);
    }
  }
  grid.appendChild(mk('Cad', cadWrap));

  card.appendChild(grid);

  // Acciones
  const actions = document.createElement('div');
  actions.className = 'lote-card-actions';

  const mkBtn = (txt, title, cls, action) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.className = cls;
    b.dataset.action = action;
    b.dataset.id = String(lote.id);
    return b;
  };

  actions.appendChild(mkBtn('👁','Ver','btn icon','view'));
  actions.appendChild(mkBtn('✎','Editar','btn secondary icon','edit'));
  actions.appendChild(mkBtn('🗑','Borrar','btn danger icon','delete'));

  card.appendChild(actions);

  return card;
}

function refreshListCacheIfNeeded(force){
  let fresh;
  try{
    fresh = readLotesAndMetaFresh();
  }catch(_){
    fresh = { lotes: [], meta: { rev: 0 } };
  }
  const meta = fresh && fresh.meta ? fresh.meta : {};
  const rev = (meta && typeof meta.rev === 'number') ? meta.rev : 0;

  if (!force && listView.metaRev === rev && Array.isArray(listView.allSorted) && listView.allSorted.length){
    return;
  }

  const lotes = Array.isArray(fresh.lotes) ? fresh.lotes : [];

  const sorted = [...lotes].sort((a, b) => {
    const ta = getCreatedTimestamp(a);
    const tb = getCreatedTimestamp(b);
    if (ta !== tb) return tb - ta;

    const fa = toTimestamp(a?.fecha);
    const fb = toTimestamp(b?.fecha);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb) return fb - fa;
    return (a.codigo || "").localeCompare(b.codigo || "");
  });

  listView.metaRev = rev;
  listView.allSorted = sorted;
  listView.byId = new Map(sorted.map((l) => [String(l?.id), l]));

  // Índice de búsqueda simple (lowercase) para filtrar rápido
  const idx = new Map();
  for (const l of sorted){
    const id = String(l?.id ?? '');
    const s = [
      l?.codigo, l?.batchCode, l?.fecha, l?.caducidad,
      l?.assignedEventName, l?.status, l?.loteType, l?.parentLotId
    ].filter(Boolean).join(' ').toLowerCase();
    idx.set(id, s);
  }
  listView.searchIndex = idx;
}

function applyListFilter(){
  const q = (listView.query || '').toString().trim().toLowerCase();
  if (!q){
    listView.filtered = listView.allSorted;
  } else {
    const out = [];
    for (const l of listView.allSorted){
      const id = String(l?.id ?? '');
      const s = listView.searchIndex.get(id) || '';
      if (s.includes(q)) out.push(l);
    }
    listView.filtered = out;
  }

  // Totales sobre el conjunto filtrado (no solo la página)
  listView.totals = computeRemainingTotals(listView.filtered);
  updateTotalsBarUI(listView.totals);
}

function setListMetaUI(){
  const metaEl = $("list-meta");
  if (!metaEl) return;
  const total = Array.isArray(listView.filtered) ? listView.filtered.length : 0;
  const shown = Math.min(listView.rendered, total);
  const q = (listView.query || '').toString().trim();
  metaEl.textContent = q ? `Mostrando ${shown} de ${total} · filtro: \"${q}\"` : `Mostrando ${shown} de ${total}`;
}

function updateLoadMoreUI(){
  const btn = $("load-more-btn");
  if (!btn) return;
  const total = Array.isArray(listView.filtered) ? listView.filtered.length : 0;
  const remaining = Math.max(0, total - listView.rendered);
  const canMore = remaining > 0;

  btn.style.display = canMore ? 'inline-flex' : 'none';
  btn.disabled = !canMore;
  if (canMore){
    const step = Math.min(listView.pageSize, remaining);
    btn.textContent = `Cargar ${step} más`;
  }
}

function renderTable(opts){
  const options = opts && typeof opts === 'object' ? opts : {};
  const reset = options.reset !== false && !options.append;
  const append = !!options.append;
  const forceRefresh = !!options.forceRefresh;

  const table = $("lotes-table");
  const cards = $("lotes-cards");
  const useCards = !!(cards && isCardMode());

  const tbody = table ? table.querySelector('tbody') : null;

  refreshListCacheIfNeeded(forceRefresh);

  const clearContainers = () => {
    if (tbody) tbody.innerHTML = '';
    if (cards) cards.innerHTML = '';
  };

  const renderMessage = (msg) => {
    if (useCards && cards){
      cards.innerHTML = '';
      const div = document.createElement('div');
      div.textContent = msg;
      div.style.textAlign = 'center';
      div.style.padding = '0.8rem';
      div.style.color = 'var(--color-text-muted)';
      cards.appendChild(div);
      return;
    }
    if (!tbody) return;
    tbody.innerHTML = '';
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 10;
    cell.textContent = msg;
    cell.style.textAlign = 'center';
    cell.style.padding = '0.8rem';
    row.appendChild(cell);
    tbody.appendChild(row);
  };

  // No hay data
  if (!listView.allSorted.length){
    listView.filtered = [];
    listView.wanted = listView.pageSize;
    listView.rendered = 0;
    updateTotalsBarUI({ P: 0, M: 0, D: 0, L: 0, G: 0 });
    clearContainers();
    renderMessage('No hay lotes registrados todavía.');
    setListMetaUI();
    updateLoadMoreUI();
    return;
  }

  if (reset){
    listView.wanted = listView.pageSize;
    listView.rendered = 0;
    applyListFilter();
    clearContainers();
  }

  if (append){
    listView.wanted = Math.min(listView.filtered.length, listView.wanted + listView.pageSize);
  }

  // Filtrado vacío
  if (!listView.filtered.length){
    updateTotalsBarUI({ P: 0, M: 0, D: 0, L: 0, G: 0 });
    clearContainers();
    renderMessage('No hay lotes que coincidan con la búsqueda.');
    listView.rendered = 0;
    setListMetaUI();
    updateLoadMoreUI();
    return;
  }

  const target = Math.min(listView.filtered.length, listView.wanted);

  const frag = document.createDocumentFragment();
  for (let i = listView.rendered; i < target; i++){
    const item = listView.filtered[i];
    frag.appendChild(useCards ? buildLoteCard(item) : buildLoteRow(item));
  }

  if (useCards && cards){
    cards.appendChild(frag);
  } else if (tbody){
    tbody.appendChild(frag);
  }

  listView.rendered = target;
  setListMetaUI();
  updateLoadMoreUI();
}

function exportToCSV() {
  if (isExporting) return;

  const lotes = loadLotes();
  if (!lotes.length) {
    alert("No hay lotes para exportar.");
    return;
  }

  const btn = $("export-btn");
  const prevLabel = btn ? btn.textContent : "";

  isExporting = true;
  setExportHint("Exportando…", false);
  if (btn){
    btn.disabled = true;
    btn.textContent = "Exportando…";
    btn.setAttribute('aria-busy','true');
  }

  try {
    if (typeof XLSX === "undefined") {
      alert("No se pudo exportar: la librería XLSX no está disponible en esta instalación.");
      setExportHint("Error al exportar (XLSX no disponible).", true);
      return;
    }

    const headers = [
      "Fecha",
      "Código",
      "Volumen total",
      "Volumen vino",
      "Volumen vodka",
      "Volumen jugo",
      "Volumen sirope",
      "Volumen agua",
      "Pulso 250 ml",
      "Media 375 ml",
      "Djeba 750 ml",
      "Litro 1000 ml",
      "Galón 3750 ml",
      "Fecha caducidad",
      "Notas",
      "Estado",
      "Evento",
    ];

    const sorted = [...lotes].sort((a, b) => {
      const ta = getCreatedTimestamp(a);
      const tb = getCreatedTimestamp(b);
      if (ta !== tb) return tb - ta;

      const fa = toTimestamp(a?.fecha);
      const fb = toTimestamp(b?.fecha);
      if (Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb) return fb - fa;
      return (a.codigo || "").localeCompare(b.codigo || "");
    });

    const rows = sorted.map((l) => [
      formatDate(l.fecha),
      l.codigo || "",
      l.volTotal || "",
      l.volVino || "",
      l.volVodka || "",
      l.volJugo || "",
      l.volSirope || "",
      l.volAgua || "",
      l.pulso ?? "",
      l.media ?? "",
      l.djeba ?? "",
      l.litro ?? "",
      l.galon ?? "",
      formatDate(l.caducidad),
      (l.notas || "").replace(/\r?\n/g, " "),
      effectiveLoteStatus(l),
      (l.assignedEventName || "").toString().trim(),
    ]);

    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lotes");

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `arcano33_lotes_${timestamp}.xlsx`;

    XLSX.writeFile(wb, filename);

    setExportHint("Export listo ✅", false);
    if (btn) btn.textContent = "Export listo ✅";
    setTimeout(() => {
      if (btn && !isExporting){
        btn.textContent = prevLabel || "Exportar a Excel";
      }
      setExportHint("", false);
    }, 1200);
  } catch (err) {
    console.error('Export error', err);
    alert("Error al exportar. Intenta de nuevo.");
    setExportHint("Error al exportar.", true);
  } finally {
    isExporting = false;
    if (btn){
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (btn.textContent === "Exportando…") btn.textContent = prevLabel || "Exportar a Excel";
    }
  }
}

// ================================
// Histórico (Etapa 5)
// ================================

function isHistoryModalOpen(){
  const m = $("history-modal");
  return !!(m && m.classList.contains('is-open'));
}

function openHistoryModal(){
  const modal = $("history-modal");
  if (!modal) return;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  renderHistoryModal();

  const inp = $("history-search");
  if (inp) {
    setTimeout(() => inp.focus(), 0);
  }
}

function closeHistoryModal(){
  const modal = $("history-modal");
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

function archiveSortTs(a){
  const td = toTimestamp(a?.deletedAt);
  if (Number.isFinite(td)) return td;
  const tc = toTimestamp(a?.createdAt);
  if (Number.isFinite(tc)) return tc;
  // Fallback a ids/otros
  const id = (a?.archiveId || a?.originalId || "").toString();
  const m = id.match(/(\d{10,})/);
  return m ? Number(m[1]) : 0;
}

function makeChip(text, cls){
  const s = document.createElement('span');
  s.className = 'chip ' + (cls || '');
  s.textContent = text;
  return s;
}

function showArchivedDetails(arch){
  if (!arch) return;
  const lines = [];
  lines.push(`Código: ${(arch.codigo || '').toString()}`);
  if (arch.originalId) lines.push(`Lote ID: ${arch.originalId}`);
  if (arch.statusAtDelete) lines.push(`Estado al borrar: ${arch.statusAtDelete}${arch.semaforoAtDelete ? ' · ' + arch.semaforoAtDelete : ''}`);
  if (arch.assignedEventName) lines.push(`Evento: ${arch.assignedEventName}`);
  lines.push(`Creado: ${formatDate(arch.createdAt)}${arch.createdAt ? ' (' + formatDateTime(arch.createdAt) + ')' : ''}`);
  lines.push(`Archivado: ${formatDate(arch.deletedAt)}${arch.deletedAt ? ' (' + formatDateTime(arch.deletedAt) + ')' : ''}`);
  lines.push('');
  lines.push('Presentaciones (unidades):');
  lines.push(`  Pulso 250 ml: ${arch.pulso ?? '0'}`);
  lines.push(`  Media 375 ml: ${arch.media ?? '0'}`);
  lines.push(`  Djeba 750 ml: ${arch.djeba ?? '0'}`);
  lines.push(`  Litro 1000 ml: ${arch.litro ?? '0'}`);
  lines.push(`  Galón 3750 ml: ${arch.galon ?? '0'}`);
  if (arch.volTotal != null && String(arch.volTotal).trim() !== '') {
    lines.push(`\nVolumen total (ml): ${arch.volTotal}`);
  }

  // eventUsage (si existe)
  const eu = arch.eventUsage && typeof arch.eventUsage === 'object' && !Array.isArray(arch.eventUsage) ? arch.eventUsage : null;
  const keys = eu ? Object.keys(eu) : [];
  if (keys.length){
    const k = keys[0];
    const snap = eu[k];
    if (snap && typeof snap === 'object'){
      lines.push('');
      lines.push('Uso por evento (snapshot):');
      if (snap.remainingTotal != null) lines.push(`  RemainingTotal: ${snap.remainingTotal}`);
      if (snap.remainingByProduct) {
        try {
          lines.push(`  RemainingByProduct: ${JSON.stringify(snap.remainingByProduct)}`);
        } catch {}
      }
    }
  }

  alert(lines.join('\n'));
}

function renderHistoryModal(){
  const listEl = $("history-list");
  const metaEl = $("history-meta");
  const inp = $("history-search");
  if (!listEl || !metaEl) return;

  const all = loadArchivedLotes();
  const q = (inp ? inp.value : '').toString().trim().toLowerCase();

  const sorted = [...all].sort((a,b) => archiveSortTs(b) - archiveSortTs(a));
  const filtered = q ? sorted.filter(r => (r.codigo || '').toString().toLowerCase().includes(q)) : sorted;

  metaEl.textContent = q
    ? `Mostrando ${filtered.length} de ${sorted.length} (filtro: "${(inp.value || '').toString().trim()}")`
    : `Total archivados: ${sorted.length}`;

  listEl.innerHTML = '';
  if (!filtered.length){
    const empty = document.createElement('div');
    empty.style.padding = '0.6rem 0.2rem';
    empty.style.color = 'var(--color-text-muted)';
    empty.style.fontSize = '0.82rem';
    empty.textContent = q ? 'Sin resultados.' : 'Aún no hay lotes archivados.';
    listEl.appendChild(empty);
    return;
  }

  for (const arch of filtered){
    const item = document.createElement('div');
    item.className = 'history-item';

    const main = document.createElement('div');
    main.className = 'history-main';

    const code = document.createElement('div');
    code.className = 'history-code';
    code.textContent = (arch.codigo || '').toString();

    const meta = document.createElement('div');
    meta.className = 'history-meta-line';

    // Estado / semáforo
    const st = (arch.statusAtDelete || '').toString().trim().toUpperCase();
    if (st){
      const cls = st === 'DISPONIBLE' ? 'chip--available' : st === 'EN_EVENTO' ? 'chip--in-event' : 'chip--closed';
      meta.appendChild(makeChip(st === 'EN_EVENTO' ? 'EN EVENTO' : st, cls));
    }
    const sem = (arch.semaforoAtDelete || '').toString().trim().toUpperCase();
    if (sem && st === 'EN_EVENTO'){
      meta.appendChild(makeChip(sem, sem === 'VENDIDO' ? 'chip--sold' : 'chip--partial'));
    }

    // Presentaciones (compactas)
    const p = Number(arch.pulso ?? 0);
    const m = Number(arch.media ?? 0);
    const d = Number(arch.djeba ?? 0);
    const l = Number(arch.litro ?? 0);
    const g = Number(arch.galon ?? 0);
    if ([p,m,d,l,g].some(n => Number.isFinite(n) && n > 0)){
      if (p > 0) meta.appendChild(makeChip(`P:${p}`, ''));
      if (m > 0) meta.appendChild(makeChip(`M:${m}`, ''));
      if (d > 0) meta.appendChild(makeChip(`D:${d}`, ''));
      if (l > 0) meta.appendChild(makeChip(`L:${l}`, ''));
      if (g > 0) meta.appendChild(makeChip(`G:${g}`, ''));
    }

    // Fechas
    const dates = document.createElement('span');
    dates.textContent = `Creado ${formatDate(arch.createdAt)} · Archivado ${formatDate(arch.deletedAt)}`;
    meta.appendChild(dates);

    // Evento (si existe)
    const ev = (arch.assignedEventName || '').toString().trim();
    if (ev){
      const evSpan = document.createElement('span');
      evSpan.textContent = `Evento: ${ev}`;
      meta.appendChild(evSpan);
    }

    main.appendChild(code);
    main.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'btn secondary icon';
    viewBtn.title = 'Ver';
    viewBtn.setAttribute('aria-label', 'Ver');
    viewBtn.textContent = '👁';
    viewBtn.addEventListener('click', () => showArchivedDetails(arch));

    actions.appendChild(viewBtn);

    item.appendChild(main);
    item.appendChild(actions);

    listEl.appendChild(item);
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js?v=4.20.77&r=1")
      .catch((err) => console.error("SW error", err));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Inicializar fecha y caducidad
  const fechaInput = $("fecha");
  const cadInput = $("caducidad");

  const today = new Date().toISOString().slice(0, 10);
  fechaInput.value = today;
  cadInput.value = calculateCaducidad(today);

  fechaInput.addEventListener("change", () => {
    cadInput.value = calculateCaducidad(fechaInput.value);
  });

  $("lote-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (isSavingLote) return; // anti doble-acción

    const saveBtn = $("save-btn");
    const prevLabel = saveBtn ? saveBtn.textContent : "";
    isSavingLote = true;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Guardando...";
    }

    let savedOk = false;
    try {
      const formData = readFormData();
      if (!formData) return;

      // Etapa 2: siempre re-leer la data antes de guardar (evita pisadas Calculadora/POS)
      const fresh = readLotesAndMetaFresh();
      const lotes = Array.isArray(fresh.lotes) ? fresh.lotes : [];

      // Normalizar el patch (tolerar números raros/fechas)
      const data = normalizeLoteRecord(formData) || formData;

      const index = lotes.findIndex((l) => String(l?.id) === String(data.id));
      const cur = index >= 0 ? lotes[index] : null;

      // Resolver identidad estable (sin cambiar id del lote existente)
      const resolvedLoteId = (cur?.loteId || cur?.id)
        ? String(cur.loteId || cur.id)
        : String(data.loteId || data.id || deriveStableLoteId(data));
      data.loteId = resolvedLoteId;
      data.batchCode = canonicalBatchCode(data.codigo) || data.batchCode || undefined;

      // Conflicto obvio: el mismo lote fue modificado en otro módulo/pestaña
      if (index >= 0 && editingCtx && String(editingCtx.id) === String(data.id)) {
        const nowFp = nonEditableFingerprint(cur);
        if (editingCtx.fingerprint && nowFp && editingCtx.fingerprint !== nowFp) {
          alert('Conflicto: este lote cambió desde otro módulo/pestaña. Recarga la página y vuelve a intentar (para evitar pisar cambios).');
          return;
        }
      }

      // Dedupe conservador (NO sobreescribir silenciosamente)
      const newId = String(data.loteId || data.id || "");
      const newBC = String(data.batchCode || "");
      const dup = lotes.find((l, i) => {
        if (index >= 0 && i === index) return false;
        const lid = String(l?.loteId || l?.id || "");
        const bc = String(l?.batchCode || canonicalBatchCode(l?.codigo) || "");
        return (newId && lid && lid === newId) || (newBC && bc && bc === newBC);
      });
      if (dup) {
        const shown = (dup?.codigo || dup?.batchCode || '').toString();
        alert(`Duplicado bloqueado: ya existe un lote con el mismo código/identidad (${shown}).`);
        return;
      }

      if (index >= 0) {
        // Merge conservador: solo campos editables; preservar refs/eventUsage/status/etc.
        const merged = { ...(cur || {}) };
        const editableKeys = [
          'fecha','codigo','caducidad',
          'volTotal','volVino','volVodka','volJugo','volSirope','volAgua',
          'pulso','media','djeba','litro','galon',
          'notas','batchCode','loteId'
        ];
        for (const k of editableKeys) {
          if (data[k] !== undefined) merged[k] = data[k];
        }
        // Nunca cambiar el id visible (compat con POS)
        merged.id = cur.id;
        if (!merged.createdAt && data.createdAt) merged.createdAt = data.createdAt;
        merged.updatedAt = new Date().toISOString();
        lotes[index] = normalizeLoteRecord(merged) || merged;
      } else {
        const createdAt = data.createdAt || new Date().toISOString();
        const nuevo = normalizeLoteRecord({ ...data, createdAt }) || { ...data, createdAt };
        lotes.push(nuevo);
      }

      const ok = saveLotes(lotes);
      if (!ok) return;

      renderTable({ reset: true, forceRefresh: true });
      clearForm();
      savedOk = true;
    } finally {
      isSavingLote = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = savedOk ? "Guardar lote" : (prevLabel || (editingId ? "Actualizar lote" : "Guardar lote"));
      }
    }
  });

  $("reset-btn").addEventListener("click", () => clearForm());

  // Etapa 3: búsqueda (debounce) + paginación
  const listSearch = $("list-search");
  const clearSearch = $("clear-search-btn");
  const loadMore = $("load-more-btn");

  const applySearch = debounce(() => {
    listView.query = (listSearch ? listSearch.value : '').toString();
    renderTable({ reset: true });
  }, 160);

  if (listSearch) listSearch.addEventListener('input', applySearch);
  if (clearSearch) clearSearch.addEventListener('click', () => {
    if (listSearch) listSearch.value = '';
    listView.query = '';
    renderTable({ reset: true });
    if (listSearch) listSearch.focus();
  });
  if (loadMore) loadMore.addEventListener('click', () => renderTable({ append: true, reset: false }));

  // Etapa 3: delegación de eventos para acciones (menos listeners con data grande)
  const lotesTable = $("lotes-table");
  if (lotesTable) {
    lotesTable.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
      if (!btn) return;

      const action = (btn.dataset.action || '').toString();
      const id = (btn.dataset.id || '').toString();
      if (!action || !id) return;

      const lote = listView.byId.get(id) || null;
      if (!lote) return;

      if (action === 'view') {
        showLoteDetails(lote);
        return;
      }

      if (action === 'edit') {
        populateForm(lote);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (action === 'delete') {
        const code = (lote.codigo || '').toString().trim();
        const _stForDelete = effectiveLoteStatus(lote);
        const _semForDelete = _stForDelete === 'EN_EVENTO' ? getLoteSemaforoState(lote) : '';

        if (_semForDelete === 'PARCIAL') {
          const ok = confirm(
            `Este lote aún tiene remanente. No se recomienda borrar.\n\n` +
            `Si estás seguro, toca Aceptar para continuar.`
          );
          if (!ok) return;

          const typed = prompt(
            `Confirmación fuerte: escribe el CÓDIGO del lote para borrar:\n\n${code}`
          );
          if ((typed || '').toString().trim() !== code) {
            alert('Borrado cancelado: el código no coincide.');
            return;
          }
        } else {
          if (!confirm(`¿Borrar el lote ${code}?`)) return;
        }

        // Etapa 5: archivar snapshot antes de removerlo de activos
        const deletedAtIso = new Date().toISOString();
        try { archiveLote(lote, deletedAtIso); } catch (e){ console.warn('No se pudo archivar lote', e); }

        const current = loadLotes().filter((l) => String(l.id) !== String(lote.id));
        saveLotes(current);
        if (editingId === lote.id) clearForm();
        renderTable({ reset: true, forceRefresh: true });

        if (isHistoryModalOpen()) renderHistoryModal();
      }
    });
  }

  // Etapa 3: acciones también en vista tipo tarjeta (iPad-first)
  const lotesCards = $("lotes-cards");
  if (lotesCards) {
    lotesCards.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
      if (!btn) return;

      const action = (btn.dataset.action || '').toString();
      const id = (btn.dataset.id || '').toString();
      if (!action || !id) return;

      const lote = listView.byId.get(id) || null;
      if (!lote) return;

      if (action === 'view') {
        showLoteDetails(lote);
        return;
      }

      if (action === 'edit') {
        populateForm(lote);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (action === 'delete') {
        const code = (lote.codigo || '').toString().trim();
        const _stForDelete = effectiveLoteStatus(lote);
        const _semForDelete = _stForDelete === 'EN_EVENTO' ? getLoteSemaforoState(lote) : '';

        if (_semForDelete === 'PARCIAL') {
          const ok = confirm(
            `Este lote aún tiene remanente. No se recomienda borrar.

` +
            `Si estás seguro, toca Aceptar para continuar.`
          );
          if (!ok) return;

          const typed = prompt(
            `Confirmación fuerte: escribe el CÓDIGO del lote para borrar:

${code}`
          );
          if ((typed || '').toString().trim() !== code) {
            alert('Borrado cancelado: el código no coincide.');
            return;
          }
        } else {
          if (!confirm(`¿Borrar el lote ${code}?`)) return;
        }

        const deletedAtIso = new Date().toISOString();
        try { archiveLote(lote, deletedAtIso); } catch (e){ console.warn('No se pudo archivar lote', e); }

        const current = loadLotes().filter((l) => String(l.id) !== String(lote.id));
        saveLotes(current);
        if (editingId === lote.id) clearForm();
        renderTable({ reset: true, forceRefresh: true });

        if (isHistoryModalOpen()) renderHistoryModal();
      }
    });
  }

  // Si cambia el layout (rotación / resize), re-render sin perder filtros.
  try{
    const mq = window.matchMedia('(max-width: 1024px)');
    mq.addEventListener('change', () => renderTable({ reset: true }));
  }catch(_){ }

  $("export-btn").addEventListener("click", () => exportToCSV());

  // Histórico (Etapa 5)
  const histBtn = $("history-btn");
  if (histBtn) histBtn.addEventListener('click', () => openHistoryModal());

  const histClose = $("history-close-btn");
  if (histClose) histClose.addEventListener('click', () => closeHistoryModal());

  const histModal = $("history-modal");
  if (histModal) {
    histModal.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-modal-close') === '1') {
        closeHistoryModal();
      }
    });
  }

  const histSearch = $("history-search");
  if (histSearch) {
    histSearch.addEventListener('input', () => renderHistoryModal());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isHistoryModalOpen()) {
      closeHistoryModal();
    }
  });

  $("clear-all-btn").addEventListener("click", () => {
    if (!confirm("¿Borrar todos los lotes registrados?")) return;
    A33Storage.removeItem(STORAGE_KEY);
    clearForm();
    renderTable({ reset: true, forceRefresh: true });
  });

  renderTable({ reset: true, forceRefresh: true });
  registerServiceWorker();
});
