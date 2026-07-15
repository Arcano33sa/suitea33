// --- IndexedDB helpers POS
const DB_NAME = 'a33-pos';
const DB_VER = 35; // Productos por productId: índice de nombre no único
let db;

// --- Build / version (fuente unica de verdad)
const POS_BUILD = (typeof window !== 'undefined' && window.A33_VERSION) ? String(window.A33_VERSION) : '4.20.89';


const POS_SW_CACHE = (typeof window !== 'undefined' && window.A33_POS_CACHE_NAME) ? String(window.A33_POS_CACHE_NAME) : ('a33-v' + POS_BUILD + '-pos-r1-m29');

// --- Util: round2 (2 decimales) — Hotfix Ventas Etapa 1/3
// Nota: evita NaN y errores de flotante (EPSILON). Retorna Number.
function round2(n){
  let x = Number(n);
  if (!Number.isFinite(x)) x = 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}


// --- Util: moneyEquals (comparación monetaria robusta) — Hotfix Ventas Etapa 1/2
// Compara montos a nivel de centavos (evita falsos negativos por flotantes).
function moneyEquals(a, b, epsilonCents){
  const eps = (epsilonCents == null || epsilonCents === '') ? 0 : Math.max(0, Math.round(Number(epsilonCents)));
  const ca = Math.round((round2(a) + Number.EPSILON) * 100);
  const cb = Math.round((round2(b) + Number.EPSILON) * 100);
  return Math.abs(ca - cb) <= eps;
}
try{ window.moneyEquals = moneyEquals; }catch(_){ }


// --- Date helpers (POS)
// Normaliza YYYY-MM-DD y da fallback robusto (consistente con Centro de Mando)
function todayYMD(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function safeYMD(v){
  // Normaliza YYYY-MM-DD para llaves de stores (robusto para iPad / inputs raros)
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Si viene ISO completo, tomar los primeros 10 chars
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0,10);
  // Intento final: parse de Date
  try{
    const d = new Date(s);
    if (isFinite(d)) {
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${day}`;
    }
  }catch(_){ }
  return todayYMD();
}

// --- POS: Efectivo v2 (storage aislado, sin UI en Etapa 1)
const CASH_V2_STORE = 'cashV2';

function cashV2AssertEventId(eventId){
  const eid = String(eventId == null ? '' : eventId).trim();
  if (!eid) throw new Error('cashV2: eventId requerido');
  return eid;
}

function cashV2AssertDayKeyCanon(dayKey){
  const dk = String(dayKey == null ? '' : dayKey).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)){
    throw new Error('cashV2: dayKey canónico requerido (YYYY-MM-DD)');
  }
  return dk;
}


function cashV2DayKeyFromTsLocal(ts){
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return todayYMD();
  const d = new Date(n);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function cashV2NormStatus(v){
  const s = String(v || 'OPEN').trim().toUpperCase();
  return (s === 'CLOSED') ? 'CLOSED' : 'OPEN';
}

function cashV2DeriveOpenTs(rec){
  try{
    const n = Number(rec && rec.openTs);
    if (Number.isFinite(n) && n > 0) return n;
  }catch(_){ }
  // Preferir dayKey para evitar ambigüedad (y mantener consistencia con la key)
  try{
    const dk = safeYMD(rec && rec.dayKey);
    const t = new Date(dk + 'T00:00:00').getTime();
    if (Number.isFinite(t) && t > 0) return t;
  }catch(_){ }
  try{
    const ca = rec && rec.meta && rec.meta.createdAt ? Date.parse(rec.meta.createdAt) : NaN;
    if (Number.isFinite(ca) && ca > 0) return ca;
  }catch(_){ }
  return Date.now();
}

function cashV2DeriveCloseTs(rec){
  try{
    const n = Number(rec && rec.closeTs);
    if (Number.isFinite(n) && n > 0) return n;
  }catch(_){ }
  try{
    const m = Number(rec && rec.meta && rec.meta.closedAt);
    if (Number.isFinite(m) && m > 0) return m;
  }catch(_){ }
  try{
    const ua = rec && rec.meta && rec.meta.updatedAt ? Date.parse(rec.meta.updatedAt) : NaN;
    if (Number.isFinite(ua) && ua > 0) return ua;
  }catch(_){ }
  return Date.now();
}

async function cashV2ResolveOperationalDayKey(eventId, fallbackDayKey){
  const eid = cashV2AssertEventId(eventId);
  const fb = cashV2AssertDayKeyCanon(safeYMD(fallbackDayKey));
  try{ if (!db) await openDB(); }catch(_){ }
  let all = [];
  try{ all = await getAll(CASH_V2_STORE); if (!Array.isArray(all)) all = []; }catch(_){ all = []; }
  const open = (all || []).filter(r => r && String(r.eventId) === String(eid) && cashV2NormStatus(r.status) === 'OPEN');
  if (!open.length) return fb;
  open.sort((a,b)=> cashV2DeriveOpenTs(b) - cashV2DeriveOpenTs(a));
  const dk = safeYMD(open[0].dayKey || fb);
  return dk;
}


// --- POS: Efectivo v2 — Multi-día (Etapa 3/5)
function getTodayDayKey(){
  // “Hoy” = dayKey local (YYYY-MM-DD) basado en Date.now().
  return todayYMD();
}

async function getLatestDayForEvent(eventId){
  const eid = cashV2AssertEventId(eventId);
  try{ if (!db) await openDB(); }catch(_){ }
  let all = [];
  try{ all = await getAll(CASH_V2_STORE); if (!Array.isArray(all)) all = []; }catch(_){ all = []; }
  const items = [];
  for (const r of (all || [])){
    if (!r || typeof r !== 'object') continue;
    if (String(r.eventId) !== String(eid)) continue;
    const dk = safeYMD(r.dayKey || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    items.push({ dk, rec: r });
  }
  items.sort((a,b)=>{
    if (b.dk > a.dk) return 1;
    if (b.dk < a.dk) return -1;
    const at = cashV2DeriveOpenTs(a.rec);
    const bt = cashV2DeriveOpenTs(b.rec);
    return (bt - at);
  });
  return items.length ? items[0].rec : null;
}

async function cashV2OpenTodayFromPrevClosed(eventId, todayDayKey){
  const eid = cashV2AssertEventId(eventId);
  const todayKey = cashV2AssertDayKeyCanon(safeYMD(todayDayKey || getTodayDayKey()));
  try{ if (!db) await openDB(); }catch(_){ }

  // Idempotencia: si ya existe, no crear otro.
  const existing = await cashV2Load(eid, todayKey);
  if (existing) return existing;

  const prev = await getLatestDayForEvent(eid);
  if (!prev) throw new Error('No hay registro previo para copiar saldo.');
  const prevDayKey = cashV2AssertDayKeyCanon(safeYMD(prev.dayKey || ''));
  if (prevDayKey === todayKey) throw new Error('Ya existe registro para hoy.');
  if (cashV2NormStatus(prev.status) !== 'CLOSED') throw new Error('Primero cierra el día anterior.');

  if (!prev.final) throw new Error('El día anterior no tiene conteo final guardado.');

  // Copia: initial se deriva del final contado anterior (denomCounts + total por moneda).
  // Regla: si faltan claves en denomCounts, se completan con 0 (normalización defensiva).
  // Regla: el total SIEMPRE se recalcula desde denomCounts (fuente de verdad), redondeado a 2 decimales.
  const initial = cashV2DefaultInitial();
  try{
    for (const ccy of ['NIO','USD']){
      const prevCounts = prev && prev.final && prev.final[ccy] && prev.final[ccy].denomCounts;
      const normCounts = normalizeDenomCounts(ccy, prevCounts);
      initial[ccy].denomCounts = normCounts;
      initial[ccy].total = cashV2SumDenomTotal(ccy, normCounts);
    }
  }catch(_){ }

  const nowIso = new Date().toISOString();
  let openTs = Date.now();
  try{
    const dkFromTs = cashV2DayKeyFromTsLocal(openTs);
    if (dkFromTs !== todayKey){
      const t = new Date(todayKey + 'T00:00:00').getTime();
      if (Number.isFinite(t) && t > 0) openTs = t;
    }
  }catch(_){ }

  let inheritedFx = null;
  try{ inheritedFx = posCurrencyCentralExchangeRatePOS(); }catch(_){ inheritedFx = null; }

  const rec = {
    version: 2,
    key: cashV2Key(eid, todayKey),
    eventId: eid,
    dayKey: todayKey,
    openTs,
    status: 'OPEN',
    closeTs: null,
    fx: (inheritedFx != null ? cashV2CoerceFx(inheritedFx) : null),
    initial,
    movements: [],
    final: null,
    meta: { createdAt: nowIso, updatedAt: nowIso, openedFromDayKey: prevDayKey }
  };

  await put(CASH_V2_STORE, rec);
  return rec;
}

function cashV2InitMultiDayUIOnce(){
  const btn = document.getElementById('cashv2-btn-open-from-yesterday');
  if (!btn) return;
  if (btn.dataset.ready === '1') return;

  btn.addEventListener('click', async ()=>{
    const eid = String(btn.dataset.eventId || '').trim();
    const dk = String(btn.dataset.todayKey || '').trim() || getTodayDayKey();
    if (!eid) return;
    try{
      btn.disabled = true;
      await cashV2OpenTodayFromPrevClosed(eid, dk);
      try{ toast('Día abierto (saldo copiado)'); }catch(_){ }
    }catch(err){
      console.error('[A33][CASHv2] open today from prev error', err);
      const msg = (err && (err.message || err.name)) ? (err.message || err.name) : String(err);
      try{ toast(msg); }catch(_){ }
    }finally{
      try{ btn.disabled = false; }catch(_){ }
      try{ await renderEfectivoTab(); }catch(_){ }
    }
  });

  btn.dataset.ready = '1';
}


function cashV2Key(eventId, dayKey){
  const eid = cashV2AssertEventId(eventId);
  const dk = cashV2AssertDayKeyCanon(dayKey);
  return `cash:v2:${eid}:${dk}`;
}

async function cashV2Load(eventId, dayKey){
  const key = cashV2Key(eventId, dayKey);
  if (!db) await openDB();
  const v = await getOne(CASH_V2_STORE, key);
  return v || null;
}

async function cashV2Ensure(eventId, dayKey){
  const eid = cashV2AssertEventId(eventId);
  const dk = cashV2AssertDayKeyCanon(dayKey);
  const key = cashV2Key(eid, dk);
  if (!db) await openDB();

  let existing = await getOne(CASH_V2_STORE, key);
  if (existing){
    // Normalizar: 1 sola verdad (status/openTs/closeTs)
    let changed = false;
    try{
      const ns = cashV2NormStatus(existing.status);
      if (String(existing.status||'').trim().toUpperCase() != ns){ existing.status = ns; changed = true; }
    }catch(_){ }
    try{
      const ot = cashV2DeriveOpenTs(existing);
      if (!Number.isFinite(Number(existing.openTs)) || Number(existing.openTs) <= 0){ existing.openTs = ot; changed = true; }
    }catch(_){ }
    try{
      if (cashV2NormStatus(existing.status) === 'CLOSED'){
        const ct = cashV2DeriveCloseTs(existing);
        if (!Number.isFinite(Number(existing.closeTs)) || Number(existing.closeTs) <= 0){ existing.closeTs = ct; changed = true; }
        try{ existing.meta = (existing.meta && typeof existing.meta==='object') ? existing.meta : {}; existing.meta.closedAt = Number(existing.closeTs)||Number(existing.meta.closedAt)||Date.now(); }catch(__){ }
      } else {
        if (existing.closeTs != null){ existing.closeTs = null; changed = true; }
        try{ if (existing.meta && existing.meta.closedAt != null){ delete existing.meta.closedAt; changed = true; } }catch(__){ }
      }
    }catch(_){ }

    // Etapa 8/9: si el día abierto no tiene T/C propio, reflejar el T/C central sin tocar días cerrados.
    try{
      if (cashV2NormStatus(existing.status) !== 'CLOSED' && cashV2FxNorm(existing.fx) == null){
        const central = posCurrencyCentralExchangeRatePOS();
        if (central != null){
          existing.fx = cashV2CoerceFx(central);
          changed = true;
        }
      }
    }catch(_){ }

    if (changed){
      try{ existing = await cashV2Save(existing); }catch(_){ }
    }
    // Etapa 2/5: Histórico debe reflejar días OPEN/CLOSED aunque no haya snapshot.
    try{ await cashV2HistUpsertHeaderFromV2(existing); }catch(_){ }
    return existing;
  }

  const nowIso = new Date().toISOString();
  let openTs = Date.now();
  // Defensa: si alguien pide un dk que no coincide con el día local de openTs, alinear openTs al dk.
  try{
    const derived = cashV2DayKeyFromTsLocal(openTs);
    if (derived !== dk){
      const t = new Date(dk + 'T00:00:00').getTime();
      if (Number.isFinite(t) && t > 0) openTs = t;
    }
  }catch(_){ }

  let inheritedFx = null;
  try{ inheritedFx = posCurrencyCentralExchangeRatePOS(); }catch(_){ inheritedFx = null; }

  const cashDay = {
    version: 2,
    key,
    eventId: eid,
    dayKey: dk,
    openTs,
    status: 'OPEN',
    closeTs: null,
    fx: (inheritedFx != null ? cashV2CoerceFx(inheritedFx) : null),
    initial: null,
    movements: [],
    final: null,
    meta: { createdAt: nowIso, updatedAt: nowIso }
  };
  await put(CASH_V2_STORE, cashDay);
  // Etapa 2/5: registrar header OPEN en Histórico (sin snapshot)
  try{ await cashV2HistUpsertHeaderFromV2(cashDay); }catch(_){ }
  return cashDay;
}

async function cashV2Save(cashDay){
  if (!cashDay || typeof cashDay !== 'object') throw new Error('cashV2: cashDay inválido');
  if (Number(cashDay.version) !== 2) throw new Error('cashV2: version=2 requerido');
  const eid = cashV2AssertEventId(cashDay.eventId);
  const dk = cashV2AssertDayKeyCanon(cashDay.dayKey);
  const key = cashV2Key(eid, dk);
  if (cashDay.key && String(cashDay.key) !== key) throw new Error('cashV2: key canónica requerida');
  const now = new Date().toISOString();

  const meta = (cashDay.meta && typeof cashDay.meta === 'object') ? cashDay.meta : {};
  const createdAt = (typeof meta.createdAt === 'string' && meta.createdAt.trim()) ? meta.createdAt : now;
  const updatedAt = now;

  const status = cashV2NormStatus(cashDay.status);

  // openTs: persistido (y consistente con dayKey)
  let openTs = cashV2DeriveOpenTs(cashDay);
  try{
    const derived = cashV2DayKeyFromTsLocal(openTs);
    if (derived !== dk){
      const t = new Date(dk + 'T00:00:00').getTime();
      if (Number.isFinite(t) && t > 0) openTs = t;
    }
  }catch(_){ }

  // closeTs: solo si CLOSED
  let closeTs = null;
  if (status === 'CLOSED'){
    closeTs = cashV2DeriveCloseTs(cashDay);
  }

  const meta2 = { ...meta, createdAt, updatedAt };
  if (status === 'CLOSED'){
    meta2.closedAt = Number(closeTs) || Number(meta2.closedAt) || Date.now();
  }else{
    try{ if (meta2.closedAt != null) delete meta2.closedAt; }catch(_){ }
  }

  const toSave = {
    ...cashDay,
    version: 2,
    key,
    eventId: eid,
    dayKey: dk,
    openTs,
    status,
    closeTs,
    fx: cashV2CoerceFx(cashDay.fx),
    initial: (cashDay.initial == null ? null : cashDay.initial),
    movements: Array.isArray(cashDay.movements) ? cashDay.movements : [],
    final: (cashDay.final == null ? null : cashDay.final),
    meta: meta2
  };

  if (!db) await openDB();
  await put(CASH_V2_STORE, toSave);
  return toSave;
}

try{ window.cashV2Load = cashV2Load; }catch(_){ }
try{ window.cashV2Ensure = cashV2Ensure; }catch(_){ }
try{ window.cashV2Save = cashV2Save; }catch(_){ }
try{ window.cashV2Key = cashV2Key; }catch(_){ }


// --- POS: Efectivo v2 — Histórico (storage aislado + llaves canónicas + versionado) — Etapa 1/5
const CASH_V2_HIST_STORE = 'cashv2hist';
const CASH_V2_SNAP_STORE = 'cashv2snap';

function getCashV2HistDayKey(recordV2){
  // dayKey operativo del día: basado en fecha local de apertura (openTs).
  const ot = cashV2DeriveOpenTs(recordV2 || {});
  const dk = safeYMD(cashV2DayKeyFromTsLocal(ot));
  return cashV2AssertDayKeyCanon(dk);
}

function histDayKey(eventId, dayKey){
  const eid = cashV2AssertEventId(eventId);
  const dk = cashV2AssertDayKeyCanon(safeYMD(dayKey));
  return `cashv2hist:${eid}:${dk}`;
}

function snapKey(eventId, dayKey, v){
  const eid = cashV2AssertEventId(eventId);
  const dk = cashV2AssertDayKeyCanon(safeYMD(dayKey));
  const vv = Number(v);
  const vn = (Number.isFinite(vv) && vv > 0) ? Math.trunc(vv) : 1;
  return `cashv2snap:${eid}:${dk}:v${vn}`;
}

async function loadHistDay(eventId, dayKey){
  const key = histDayKey(eventId, dayKey);
  if (!db) await openDB();
  try{
    const v = await getOne(CASH_V2_HIST_STORE, key);
    return v || null;
  }catch(_){
    return null;
  }
}

async function saveHistDay(eventId, dayKey, histDay){
  if (!histDay || typeof histDay !== 'object') throw new Error('cashV2Hist: histDay inválido');
  const eid = cashV2AssertEventId(eventId);
  const dk = cashV2AssertDayKeyCanon(safeYMD(dayKey));
  const key = histDayKey(eid, dk);
  if (!db) await openDB();

  let existing = null;
  try{ existing = await getOne(CASH_V2_HIST_STORE, key); }catch(_){ existing = null; }

  const now = Date.now();
  const createdTs = Number(existing && existing.createdTs) || Number(histDay.createdTs) || now;

  const merged = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...(histDay && typeof histDay === 'object' ? histDay : {}),
    key,
    eventId: eid,
    dayKey: dk,
    createdTs,
    updatedTs: now,
    status: cashV2NormStatus((histDay.status != null) ? histDay.status : (existing && existing.status)),
    openTs: (histDay.openTs != null) ? (Number(histDay.openTs) || null) : (existing && existing.openTs != null ? Number(existing.openTs) : null),
    closeTs: (histDay.closeTs != null) ? (Number(histDay.closeTs) || null) : (existing && existing.closeTs != null ? Number(existing.closeTs) : null)
  };

  // Idempotencia: no perder versions si no viene en el payload.
  if (!('versions' in histDay)){
    merged.versions = (existing && Array.isArray(existing.versions)) ? existing.versions : [];
  } else {
    merged.versions = Array.isArray(histDay.versions) ? histDay.versions : [];
  }

  await put(CASH_V2_HIST_STORE, merged);
  return merged;
}

async function listHistDaysForEvent(eventId){
  const eid = cashV2AssertEventId(eventId);
  if (!db) await openDB();

  // Fast path: index by_event
  const arr = await new Promise((resolve)=>{
    try{
      const tr = db.transaction([CASH_V2_HIST_STORE], 'readonly');
      const st = tr.objectStore(CASH_V2_HIST_STORE);
      let idx = null;
      try{ idx = st.index('by_event'); }catch(_){ idx = null; }
      if (!idx){ resolve(null); return; }
      const req = idx.getAll(IDBKeyRange.only(eid));
      req.onsuccess = ()=> resolve(req.result || []);
      req.onerror = ()=> resolve(null);
    }catch(_){ resolve(null); }
  });
  let out = Array.isArray(arr) ? arr : null;

  if (!out){
    try{
      const all = await getAll(CASH_V2_HIST_STORE);
      out = (Array.isArray(all) ? all : []).filter(r => r && String(r.eventId) === String(eid));
    }catch(_){
      out = [];
    }
  }

  out.sort((a,b)=>{
    const ad = safeYMD(a && a.dayKey);
    const bd = safeYMD(b && b.dayKey);
    if (bd > ad) return 1;
    if (bd < ad) return -1;
    return Number(b && b.updatedTs) - Number(a && a.updatedTs);
  });
  return out;
}

async function listHistEvents(){
  if (!db) await openDB();
  let all = [];
  try{ all = await getAll(CASH_V2_HIST_STORE); if (!Array.isArray(all)) all = []; }catch(_){ all = []; }
  // Devuelve metadata por evento. Orden: lastUpdatedTs DESC (fallback: dayKey DESC).
  // Nota: el orden de días dentro de un evento es dayKey DESC (ver listHistDaysForEvent).
  const map = new Map();
  for (const r of (all || [])){
    const eid = String(r && r.eventId || '').trim();
    if (!eid) continue;
    const dk = safeYMD(r && r.dayKey);
    const updatedTs = Math.max(
      Number(r && r.updatedTs) || 0,
      Number(r && r.openTs) || 0,
      Number(r && r.closeTs) || 0
    );
    const cur = map.get(eid) || { eventId: eid, lastUpdatedTs: 0, lastDayKey: '', daysCount: 0 };
    cur.daysCount += 1;
    if (updatedTs > (Number(cur.lastUpdatedTs) || 0)) cur.lastUpdatedTs = updatedTs;
    if (dk && dk > String(cur.lastDayKey || '')) cur.lastDayKey = dk;
    map.set(eid, cur);
  }
  const out = Array.from(map.values());
  out.sort((a,b)=>{
    const at = Number(a && a.lastUpdatedTs) || 0;
    const bt = Number(b && b.lastUpdatedTs) || 0;
    if (bt !== at) return bt - at;
    const ad = String(a && a.lastDayKey || '');
    const bd = String(b && b.lastDayKey || '');
    if (bd > ad) return 1;
    if (bd < ad) return -1;
    return String(b && b.eventId || '').localeCompare(String(a && a.eventId || ''));
  });
  return out;
}

async function saveSnapshot(snapshot){
  if (!snapshot || typeof snapshot !== 'object') throw new Error('cashV2Snap: snapshot inválido');
  const eid = cashV2AssertEventId(snapshot.eventId);
  const dk = cashV2AssertDayKeyCanon(safeYMD(snapshot.dayKey));
  const vv = Number(snapshot.v);
  const vn = (Number.isFinite(vv) && vv > 0) ? Math.trunc(vv) : 1;
  const key = snapKey(eid, dk, vn);
  const ts = Number(snapshot.ts);
  const ts2 = (Number.isFinite(ts) && ts > 0) ? ts : Date.now();
  const toSave = {
    ...snapshot,
    key,
    eventId: eid,
    dayKey: dk,
    v: vn,
    ts: ts2,
    statusAtSnap: 'CLOSED'
  };
  if (!db) await openDB();
  await put(CASH_V2_SNAP_STORE, toSave);
  return toSave;
}

async function loadSnapshot(eventId, dayKey, v){
  const key = snapKey(eventId, dayKey, v);
  if (!db) await openDB();
  try{
    const r = await getOne(CASH_V2_SNAP_STORE, key);
    return r || null;
  }catch(_){
    return null;
  }
}

async function listSnapshots(eventId, dayKey){
  const eid = cashV2AssertEventId(eventId);
  const dk = cashV2AssertDayKeyCanon(safeYMD(dayKey));
  if (!db) await openDB();

  // Fast path: index by_event_day
  const arr = await new Promise((resolve)=>{
    try{
      const tr = db.transaction([CASH_V2_SNAP_STORE], 'readonly');
      const st = tr.objectStore(CASH_V2_SNAP_STORE);
      let idx = null;
      try{ idx = st.index('by_event_day'); }catch(_){ idx = null; }
      if (!idx){ resolve(null); return; }
      const req = idx.getAll(IDBKeyRange.only([eid, dk]));
      req.onsuccess = ()=> resolve(req.result || []);
      req.onerror = ()=> resolve(null);
    }catch(_){ resolve(null); }
  });

  let rows = Array.isArray(arr) ? arr : null;
  if (!rows){
    try{
      const all = await getAll(CASH_V2_SNAP_STORE);
      rows = (Array.isArray(all) ? all : []).filter(r => r && String(r.eventId) === String(eid) && safeYMD(r.dayKey) === dk);
    }catch(_){
      rows = [];
    }
  }

  const vs = [];
  for (const r of (rows || [])){
    const n = Number(r && r.v);
    if (!Number.isFinite(n)) continue;
    vs.push(Math.trunc(n));
  }
  vs.sort((a,b)=>a-b);
  // Dedup
  return Array.from(new Set(vs));
}

try{ window.getCashV2HistDayKey = getCashV2HistDayKey; }catch(_){ }
try{ window.histDayKey = histDayKey; }catch(_){ }
try{ window.snapKey = snapKey; }catch(_){ }
try{ window.loadHistDay = loadHistDay; }catch(_){ }
try{ window.saveHistDay = saveHistDay; }catch(_){ }
try{ window.listHistDaysForEvent = listHistDaysForEvent; }catch(_){ }
try{ window.listHistEvents = listHistEvents; }catch(_){ }
try{ window.saveSnapshot = saveSnapshot; }catch(_){ }
try{ window.loadSnapshot = loadSnapshot; }catch(_){ }
try{ window.listSnapshots = listSnapshots; }catch(_){ }


// --- POS: Efectivo v2 — Histórico (hook al cierre + OPEN visible) — Etapa 2/5
function cashV2HistNormalizeMove(m){
  const o = (m && typeof m === 'object') ? m : {};
  const kind = String(o.kind || '').trim().toUpperCase();
  const currency = String(o.currency || '').trim().toUpperCase();
  const out = {
    ts: Number(o.ts) || 0,
    kind: kind || 'IN',
    currency: (currency === 'USD' ? 'USD' : 'NIO'),
    amount: cashV2Round2Money(o.amount || 0)
  };
  try{
    const n = (o.note != null) ? String(o.note).trim() : '';
    const d = (o.desc != null) ? String(o.desc).trim() : '';
    const s = n || d;
    if (s) out.note = s;
  }catch(_){ }
  try{ if (o.id != null && String(o.id).trim() !== '') out.id = String(o.id); }catch(_){ }
  return out;
}

function cashV2HistPickCounts(block){
  const b = (block && typeof block === 'object') ? block : null;
  if (!b) return null;
  const denomCounts = (b.denomCounts && typeof b.denomCounts === 'object') ? b.denomCounts : null;
  const total = cashV2Round2Money(b.total || 0);
  return { denomCounts: denomCounts || {}, total };
}

async function cashV2HistUpsertHeaderFromV2(recordV2){
  const rec = (recordV2 && typeof recordV2 === 'object') ? recordV2 : null;
  if (!rec) return null;
  const eid = cashV2AssertEventId(rec.eventId);
  const dk = cashV2AssertDayKeyCanon(safeYMD(rec.dayKey || getCashV2HistDayKey(rec)));
  const status = cashV2NormStatus(rec.status);
  const openTs = Number(cashV2DeriveOpenTs(rec)) || null;
  const closeTs = (status === 'CLOSED') ? (Number(cashV2DeriveCloseTs(rec)) || Number(rec.closeTs) || Date.now()) : null;
  try{
    return await saveHistDay(eid, dk, { status, openTs, closeTs });
  }catch(_){
    return null;
  }
}

async function createHistorySnapshotFromV2(recordV2){
  const rec = (recordV2 && typeof recordV2 === 'object') ? recordV2 : null;
  if (!rec) return null;
  const eid = cashV2AssertEventId(rec.eventId);
  const dk = cashV2AssertDayKeyCanon(safeYMD(rec.dayKey || getCashV2HistDayKey(rec)));
  const st = cashV2NormStatus(rec.status);
  if (st !== 'CLOSED') return null;

  // HistDay actual
  let hist = null;
  try{ hist = await loadHistDay(eid, dk); }catch(_){ hist = null; }
  const versions = (hist && Array.isArray(hist.versions)) ? hist.versions.slice() : [];
  let maxV = 0;
  for (const it of versions){
    const n = Number(it && it.v);
    if (Number.isFinite(n) && n > maxV) maxV = Math.trunc(n);
  }
  // Defensa extra: si snapshots existen pero versions no, igual incrementamos bien.
  try{
    const vs = await listSnapshots(eid, dk);
    for (const v of (vs || [])){
      const n = Number(v);
      if (Number.isFinite(n) && n > maxV) maxV = Math.trunc(n);
    }
  }catch(_){ }
  const nextV = Math.max(1, maxV + 1);

  const openTs = Number(cashV2DeriveOpenTs(rec)) || null;
  const closeTs = Number(cashV2DeriveCloseTs(rec)) || Number(rec.closeTs) || Date.now();
  const snapTs = Number(rec.meta && rec.meta.closedAt) || closeTs || Date.now();

  // Números (expected/diff) del cierre
  let nums = null;
  try{ nums = cashV2ComputeCloseNumbers(rec, { preferDom: false }); }catch(_){ nums = null; }
  const nN = (nums && nums.NIO) ? nums.NIO : { expected:0, diff:0 };
  const nU = (nums && nums.USD) ? nums.USD : { expected:0, diff:0 };

  // Ventas en efectivo físicas por moneda
  let cashSalesC = 0;
  let cashSalesUSD = 0;
  try{
    if (rec.cashSalesC != null && Number.isFinite(Number(rec.cashSalesC))) cashSalesC = cashV2Round2Money(rec.cashSalesC);
    else cashSalesC = cashV2Round2Money(cashV2GetCashSalesC());
  }catch(_){ cashSalesC = 0; }
  try{
    if (rec.cashSalesUSD != null && Number.isFinite(Number(rec.cashSalesUSD))) cashSalesUSD = cashV2Round2Money(rec.cashSalesUSD);
    else cashSalesUSD = cashV2Round2Money(cashV2GetCashSalesUSD());
  }catch(_){ cashSalesUSD = 0; }
  if (!Number.isFinite(Number(cashSalesC))) cashSalesC = 0;
  if (!Number.isFinite(Number(cashSalesUSD))) cashSalesUSD = 0;

  const movs = Array.isArray(rec.movements) ? rec.movements : [];
  const movN = [];
  const movU = [];
  for (const m of movs){
    const mm = cashV2HistNormalizeMove(m);
    if (mm.currency === 'USD') movU.push(mm);
    else movN.push(mm);
  }

  const snapshot = {
    schema: 1,
    eventId: eid,
    dayKey: dk,
    v: nextV,
    ts: snapTs,
    source: 'CLOSE',
    data: {
      NIO: {
        initial: cashV2HistPickCounts(rec.initial && rec.initial.NIO),
        movements: movN,
        cashSalesC$: cashSalesC,
        expected: cashV2Round2Money(nN.expected || 0),
        finalCount: cashV2HistPickCounts(rec.final && rec.final.NIO),
        diff: cashV2Round2Money(nN.diff || 0)
      },
      USD: {
        initial: cashV2HistPickCounts(rec.initial && rec.initial.USD),
        movements: movU,
        cashSalesUSD: cashSalesUSD,
        expected: cashV2Round2Money(nU.expected || 0),
        finalCount: cashV2HistPickCounts(rec.final && rec.final.USD),
        diff: cashV2Round2Money(nU.diff || 0)
      },
      meta: {
        openTs,
        closeTs,
        eventId: eid,
        dayKey: dk,
        audit: (Array.isArray(rec.audit) ? rec.audit : [])
      }
    }
  };

  let savedSnap = null;
  try{ savedSnap = await saveSnapshot(snapshot); }catch(_){ savedSnap = null; }

  // HistDay update (status=CLOSED + append version)
  const versions2 = versions.slice();
  if (!versions2.some(it => Number(it && it.v) === nextV)){
    versions2.push({ v: nextV, ts: snapTs, source: 'CLOSE' });
  }
  try{
    await saveHistDay(eid, dk, {
      status: 'CLOSED',
      openTs,
      closeTs,
      versions: versions2
    });
  }catch(_){ }

  return savedSnap;
}

try{ window.createHistorySnapshotFromV2 = createHistorySnapshotFromV2; }catch(_){ }


// --- POS: Efectivo v2 (UI mínima) — Etapa 2
function cashV2StatusToUiPOS(status){
  const s = String(status || 'OPEN').trim().toUpperCase();
  if (s === 'OPEN') return { text:'Abierto', cls:'open' };
  if (s === 'CLOSED') return { text:'Cerrado', cls:'closed' };
  if (s === 'LOCKED') return { text:'BLOQUEADO', cls:'closed' };
  return { text: s || 'Abierto', cls: (s === 'OPEN' ? 'open' : 'closed') };
}

// --- POS: Efectivo v2 — Inicio por denominaciones (Etapa 3)
const CASHV2_DENOMS = {
  NIO: [1,5,10,20,50,100,200,500,1000],
  USD: [1,5,10,20,50,100]
};

let CASHV2_LAST_REC = null;
function cashV2SetLastRec(rec){
  try{
    if (rec && typeof rec === 'object'){
      if (rec.cashSalesC == null) rec.cashSalesC = cashV2GetCashSalesC();
      if (rec.cashSalesUSD == null) rec.cashSalesUSD = cashV2GetCashSalesUSD();
    }
  }catch(_){ }
  CASHV2_LAST_REC = rec || null;
}
function cashV2GetLastRec(){ return CASHV2_LAST_REC; }

function cashV2DefaultInitial(){
  // UX Etapa 2/3: counts VACÍOS por defecto; los cálculos interpretan vacío como 0.
  const mk = (arr)=>{ const o = {}; (arr||[]).forEach(d=>{ o[String(d)] = ''; }); return o; };
  return {
    NIO: { denomCounts: mk(CASHV2_DENOMS.NIO), total: 0 },
    USD: { denomCounts: mk(CASHV2_DENOMS.USD), total: 0 }
  };
}

function cashV2NormCount(v){
  let n = Number(v);
  if (!Number.isFinite(n)) return 0;
  n = Math.trunc(n);
  if (n < 0) n = 0;
  return n;
}

// UX Etapa 2/3: helpers para inputs vacíos (mantener vacío en UI, tratarlo como 0 en cálculos).
function cashV2IsBlankInput(v){
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

function cashV2CountToStore(raw){
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  return cashV2NormCount(s);
}

function cashV2CountDomValue(raw){
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  return String(cashV2NormCount(raw));
}

function cashV2InitUXInputsOnce(){
  const tab = document.getElementById('tab-efectivo');
  if (!tab) return;
  if (tab.dataset.uxInputs === '1') return;

  const root = document;

  const isEditable = (t)=>{
    if (!t || t.tagName !== 'INPUT') return false;
    if (t.disabled || t.readOnly) return false;
    const type = String(t.getAttribute('type') || '').trim().toLowerCase();
    if (type !== 'number') return false;
    // Solo inputs del módulo Efectivo v2
    const id = String(t.id || '');
    if (!id.startsWith('cashv2-')) return false;
    return true;
  };

  const queueSelectAll = (t)=>{
    try{ if (t == null) return; }catch(_){ return; }
    // UX: si el input arranca con "0" (por default/placeholder viejo), lo tratamos como vacío en el primer foco.
    // Para cálculos, vacío = 0 (ver cashV2NormCount + cashV2CountFromDom).
    try{
      const v = String(t.value == null ? '' : t.value);
      if (v === '0'){
        t.value = '';
        return;
      }
      if (v === '') return;
    }catch(_){ return; }
    setTimeout(()=>{
      try{ t.focus(); }catch(_){ }
      try{ t.select(); }catch(_){ }
      try{ if (t.setSelectionRange) t.setSelectionRange(0, String(t.value||'').length); }catch(_){ }
    }, 0);
  };

  root.addEventListener('focusin', (e)=>{
    const t = e && e.target;
    if (!isEditable(t)) return;
    queueSelectAll(t);
  });
  root.addEventListener('click', (e)=>{
    const t = e && e.target;
    if (!isEditable(t)) return;
    queueSelectAll(t);
  });

  tab.dataset.uxInputs = '1';
}

// Helper pedido (Etapa 4/5): normaliza denomCounts, garantiza claves y sanea valores.
function normalizeDenomCounts(currency, counts){
  const ccy = String(currency || '').trim().toUpperCase();
  const denoms = CASHV2_DENOMS[ccy] || [];
  const src = (counts && typeof counts === 'object') ? counts : {};
  const out = {};
  for (const d of denoms){
    const k = String(d);
    let raw = (src[k] != null) ? src[k] : ((src[d] != null) ? src[d] : '');
    // Si nunca se ingresó, mantener vacío (UI). Cálculos: vacío => 0.
    const rs = (raw == null) ? '' : String(raw);
    out[k] = (rs.trim() === '') ? '' : cashV2NormCount(raw);
  }
  return out;
}

function cashV2SumDenomTotal(currency, denomCounts){
  const ccy = String(currency || '').trim().toUpperCase();
  const denoms = CASHV2_DENOMS[ccy] || [];
  const dc = (denomCounts && typeof denomCounts === 'object') ? denomCounts : {};
  let total = 0;
  for (const d of denoms){
    const k = String(d);
    const cnt = cashV2NormCount((dc[k] != null) ? dc[k] : ((dc[d] != null) ? dc[d] : 0));
    total += (Number(d) * cnt);
  }
  return cashV2Round2Money(total);
}

function cashV2FmtInt(n){
  const x = Number(n||0);
  try{ return x.toLocaleString('es-NI'); }catch(_){ return String(x); }
}

function cashV2Round2Money(v){
  let n = Number(v || 0);
  if (!Number.isFinite(n)) n = 0;
  n = Math.round(n * 100) / 100;
  if (!Number.isFinite(n)) n = 0;
  return n;
}

function cashV2FmtMoney(v){
  const n = cashV2Round2Money(v);
  try{ return fmt(n); }catch(_){
    try{ return n.toLocaleString('es-NI', {minimumFractionDigits:2, maximumFractionDigits:2}); }catch(__){ return String(n); }
  }
}

function cashV2CoerceInitial(initial){
  const base = cashV2DefaultInitial();
  try{
    if (initial && typeof initial === 'object'){
      for (const ccy of ['NIO','USD']){
        const src = initial[ccy] && typeof initial[ccy] === 'object' ? initial[ccy] : null;
        const dc = src && src.denomCounts && typeof src.denomCounts === 'object' ? src.denomCounts : {};
        base[ccy].denomCounts = normalizeDenomCounts(ccy, dc);
      }
    }
  }catch(_){ }

  // Totales siempre calculados (no editables) — 2 decimales.
  for (const ccy of ['NIO','USD']){
    base[ccy].total = cashV2SumDenomTotal(ccy, base[ccy].denomCounts);
  }
  return base;
}


// --- POS: Efectivo v2 — Tipo de cambio (USD → C$) — Etapa 3/7
const CASHV2_FX_LS_KEY = 'A33.EF2.fxByEvent';

function cashV2FxNorm(raw){
  const str = String(raw == null ? '' : raw).trim().replace(',', '.');
  if (!str) return null;
  const n = Number(str);
  if (!Number.isFinite(n) || n <= 0) return null;
  const r = Math.round(n * 100) / 100;
  if (!Number.isFinite(r) || r <= 0) return null;
  return r;
}

function cashV2FxFmt2(v){
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  return (Math.round(n * 100) / 100).toFixed(2);
}

function cashV2FxLoadMap(){
  try{
    const raw = localStorage.getItem(CASHV2_FX_LS_KEY);
    if (!raw) return {};
    const m = JSON.parse(raw);
    return (m && typeof m === 'object') ? m : {};
  }catch(_){ return {}; }
}

function cashV2FxSaveMap(m){
  try{ localStorage.setItem(CASHV2_FX_LS_KEY, JSON.stringify(m || {})); }catch(_){ }
}

function cashV2FxGetCached(eventId){
  const eid = cashV2AssertEventId(eventId);
  try{
    const m = cashV2FxLoadMap();
    return cashV2FxNorm(m[eid]);
  }catch(_){ return null; }
}

function cashV2FxSetCached(eventId, rate){
  const eid = cashV2AssertEventId(eventId);
  const n = cashV2FxNorm(rate);
  if (n == null) return false;
  try{
    const m = cashV2FxLoadMap();
    m[eid] = cashV2FxFmt2(n); // guardamos "36.50" para precarga
    cashV2FxSaveMap(m);
    return true;
  }catch(_){ return false; }
}

// Canon: FX por EVENTO (IndexedDB store 'events')
// - Se guarda en events.fx como string con 2 decimales (ej: "36.50").
// - Lectura única: evento(canon) -> cache por evento -> fx del día.
const CASHV2_EVENT_FX_PROP = 'fx';
const CASHV2_EVENT_FX_FALLBACK_PROPS = ['fx','exchangeRate','exchange_rate','fxRate','tc','tipoCambio','tipo_cambio'];

function cashV2GetFxFromEventObj(ev){
  if (!ev || typeof ev !== 'object') return null;
  for (const p of CASHV2_EVENT_FX_FALLBACK_PROPS){
    try{
      if (ev[p] == null) continue;
      const n = cashV2FxNorm(ev[p]);
      if (n != null) return n;
    }catch(_){ }
  }
  return null;
}

async function cashV2PersistEventFx(eventId, rate){
  const eidNum = Number(eventId);
  const n = cashV2FxNorm(rate);
  if (!Number.isFinite(eidNum) || n == null) return false;

  try{
    if (!db) await openDB();
    const ev = await getOne('events', eidNum);
    if (ev && typeof ev === 'object'){
      ev[CASHV2_EVENT_FX_PROP] = cashV2FxFmt2(n);
      await put('events', ev);
      return true;
    }
  }catch(_){ }

  return false;
}


// Etapa 2/3: Herencia automática de FX al abrir día (sin reingresar)
// Lee el FX CANON del evento (events.fx) y, si no existe, usa fallback del cache por evento.
async function cashV2ReadEventFxCanon(eventId){
  const eid = cashV2AssertEventId(eventId);

  // 1) Canon en IndexedDB (store 'events')
  try{
    const eidNum = Number(eid);
    if (Number.isFinite(eidNum)){
      if (!db) await openDB();
      const ev = await getOne('events', eidNum);
      const r = cashV2GetFxFromEventObj(ev);
      if (r != null) return r;
    }
  }catch(_){ }

  // 2) Fallback: cache por evento (compatibilidad / precarga)
  try{
    const r2 = cashV2FxGetCached(eid);
    if (r2 != null) return r2;
  }catch(_){ }

  return null;
}

function cashV2GetFxEffective(rec, eventId, evObj){
  // Etapa 8/9 Moneda → POS: para operaciones nuevas, POS toma el T/C central.
  // No se recalculan ni migran registros históricos; los T/C guardados quedan como dato de auditoría.
  return posCurrencyCentralExchangeRatePOS();
}


// Normaliza lo que entra al record v2 (persistencia)
function cashV2CoerceFx(v){
  const n = cashV2FxNorm(v);
  return (n == null) ? null : n;
}

function cashV2SetFxEnabled(en){
  const card = document.getElementById('cashv2-fx-card');
  if (!card) return;
  // T/C ahora se gobierna desde Configuración → Moneda. Este campo queda como visor protegido.
  try{
    const inp = document.getElementById('cashv2-fx-input');
    if (inp){
      inp.disabled = true;
      inp.readOnly = true;
      inp.title = 'T/C central desde Configuración → Moneda';
    }
  }catch(_){ }
  try{ const btn = document.getElementById('cashv2-btn-save-fx'); if (btn) btn.disabled = true; }catch(_){ }
}

function cashV2ApplyFxToDom(rec, eventId, evObj){
  const inp = document.getElementById('cashv2-fx-input');
  const st = document.getElementById('cashv2-fx-save-status');
  const err = document.getElementById('cashv2-fx-error');
  const errSm = err ? err.querySelector('small') : null;

  const fixed = posCurrencyCentralExchangeRateFixedPOS();
  try{
    if (err){
      err.style.display = fixed ? 'none' : 'block';
    }
  }catch(_){ }
  try{ if (errSm) errSm.textContent = fixed ? '' : POS_CURRENCY_TC_REQUIRED_MSG; }catch(_){ }

  if (!inp) return;

  try{ inp.value = fixed; }catch(_){ }
  try{ inp.disabled = true; inp.readOnly = true; inp.title = 'T/C central desde Configuración → Moneda'; }catch(_){ }
  try{ const btn = document.getElementById('cashv2-btn-save-fx'); if (btn) btn.disabled = true; }catch(_){ }
  try{ if (st) st.textContent = fixed ? `Desde Moneda: ${fixed}` : POS_CURRENCY_TC_REQUIRED_MSG; }catch(_){ }
}


async function cashV2PromoteLegacyFxToEventIfNeeded(eventId, rec, evObj, editable){
  if (!editable) return null;
  const eid = String(eventId == null ? '' : eventId).trim();
  if (!eid || !rec || typeof rec !== 'object') return null;

  try{
    const current = cashV2GetFxFromEventObj(evObj);
    if (current != null) return current;
  }catch(_){ }

  const legacy = cashV2FxNorm(rec.fx);
  if (legacy == null) return null;

  try{
    const ok = await setEventExchangeRateByIdPOS(eid, legacy);
    if (ok){
      try{ cashV2FxSetCached(eid, legacy); }catch(_){ }
      return legacy;
    }
  }catch(_){ }
  return null;
}

function cashV2InitFxUIOnce(){
  const card = document.getElementById('cashv2-fx-card');
  const inp = document.getElementById('cashv2-fx-input');
  const btn = document.getElementById('cashv2-btn-save-fx');
  const st = document.getElementById('cashv2-fx-save-status');
  const err = document.getElementById('cashv2-fx-error');
  const errSm = err ? err.querySelector('small') : null;
  if (!card || !inp || !btn) return;
  if (btn.dataset.ready === '1') return;

  const showErr = (msg)=>{
    try{ if (errSm) errSm.textContent = msg || ''; }catch(_){ }
    try{ if (err) err.style.display = msg ? 'block' : 'none'; }catch(_){ }
  };

  let saving = false;

  const persist = async (opts)=>{
    opts = opts || {};
    if (saving) return false;
    if (btn.disabled && !opts.force) return false;
    showErr('');

    const eid = String(card.dataset.eventId || '').trim();
    const dk = String(card.dataset.dayKey || '').trim();
    const ro = String(card.dataset.readonly || '') === '1';
    if (!eid || !dk) return false;
    if (ro){
      if (!opts.silent){ try{ toast('Bloqueado: no editable'); }catch(_){ } }
      return false;
    }

    const n = cashV2FxNorm(inp.value);
    if (n == null){
      showErr('Ingresa un tipo de cambio válido (> 0).');
      if (!opts.silent){ try{ toast('Tipo de cambio inválido'); }catch(_){ } }
      return false;
    }

    const fixed = cashV2FxFmt2(n);
    try{ inp.value = fixed; }catch(_){ }
    try{ setEventFxDraftPOS(eid, fixed); }catch(_){ }

    saving = true;
    try{
      // Fuente única: primero se actualiza el T/C canónico del evento.
      const okEvent = await setEventExchangeRateByIdPOS(eid, fixed);
      if (!okEvent) throw new Error('No se pudo actualizar el T/C del evento.');

      // Compatibilidad: reflejar el mismo T/C en el registro diario abierto, sin convertirlo en fuente independiente.
      try{
        const rec = await cashV2Ensure(eid, dk);
        rec.fx = cashV2CoerceFx(fixed);
        await cashV2RefreshPhysicalSalesOnRecordPOS(rec, eid, dk);
        const saved = await cashV2Save(rec);
        try{ cashV2SetLastRec(saved); }catch(_){ }
      }catch(mirrorErr){
        console.warn('[A33][CASHv2][FX] espejo diario no crítico', mirrorErr);
      }

      try{ cashV2FxSetCached(eid, fixed); }catch(_){ }
      try{ await syncExchangeRateInputs(); }catch(_){ }

      try{ if (st) st.textContent = opts.silent ? `Actual: ${fixed}` : `Guardado: ${fixed}`; }catch(_){ }
      if (!opts.silent){ try{ toast('Tipo de cambio guardado'); }catch(_){ } }
      return true;
    }catch(e){
      console.error('[A33][CASHv2][FX] save error', e);
      try{ clearEventFxDraftPOS(eid); }catch(_){ }
      showErr('No se pudo guardar.');
      if (!opts.silent){ try{ toast('Error al guardar'); }catch(_){ } }
      return false;
    }finally{
      saving = false;
    }
  };

  inp.addEventListener('input', ()=>{
    const n = cashV2FxNorm(inp.value);
    try{
      const eid = String(card.dataset.eventId || '').trim();
      if (eid && n != null) setEventFxDraftPOS(eid, n);
    }catch(_){ }
    try{ if (st) st.textContent = n != null ? `Actual: ${cashV2FxFmt2(n)}` : '—'; }catch(_){ }
    try{ if (n != null) showErr(''); }catch(_){ }
  });

  const markButtonIntent = ()=>{
    try{ btn.dataset.skipBlurSave = '1'; }catch(_){ }
    setTimeout(()=>{ try{ delete btn.dataset.skipBlurSave; }catch(_){ } }, 350);
  };
  try{ btn.addEventListener('pointerdown', markButtonIntent); }catch(_){ }
  try{ btn.addEventListener('mousedown', markButtonIntent); }catch(_){ }
  try{ btn.addEventListener('touchstart', markButtonIntent, { passive:true }); }catch(_){ }

  inp.addEventListener('blur', ()=>{
    if (String(btn.dataset.skipBlurSave || '') === '1') return;
    const n = cashV2FxNorm(inp.value);
    if (n != null){
      try{ inp.value = cashV2FxFmt2(n); }catch(_){ }
      persist({ silent:true }).catch(err=>console.error('[A33][CASHv2][FX] blur save', err));
    }
  });

  inp.addEventListener('change', ()=>{
    persist({ silent:true }).catch(err=>console.error('[A33][CASHv2][FX] change save', err));
  });

  inp.addEventListener('keydown', (ev)=>{
    if (ev && ev.key === 'Enter'){
      try{ ev.preventDefault(); }catch(_){ }
      persist({ silent:false }).catch(err=>console.error('[A33][CASHv2][FX] enter save', err));
      try{ inp.blur(); }catch(_){ }
    }
  });

  btn.addEventListener('click', async ()=>{
    if (btn.disabled) return;
    await persist({ silent:false });
  });

  btn.dataset.ready = '1';
}

// --- POS: T/C único del evento activo conectado a Vender — Etapa 1/5
function normalizeExchangeRate(value){
  return cashV2FxNorm(value);
}

function formatExchangeRate2(value){
  return cashV2FxFmt2(value);
}

const POS_CURRENCY_TC_REQUIRED_MSG = 'Configure el T/C en Configuración → Moneda';

function posCurrencyCentralStatePOS(){
  if (window.A33Currency && typeof window.A33Currency.getState === 'function'){
    try{ return window.A33Currency.getState(); }catch(_){ }
  }
  let parsed = null;
  try{
    const key = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
    const raw = localStorage.getItem(key) || '';
    parsed = raw ? JSON.parse(raw) : null;
  }catch(_){ parsed = null; }
  const fixed = cashV2FxFmt2(cashV2FxNorm(parsed && parsed.exchangeRate));
  return {
    ok: true,
    primary: { name:'Córdoba nicaragüense', symbol:'C$', code:'NIO' },
    secondary: { name:'Dólar estadounidense', symbol:'US$', code:'USD' },
    exchangeRate: fixed ? Number(fixed) : null,
    exchangeRateText: fixed ? ('T/C ' + fixed) : 'T/C no configurado',
    hasExchangeRate: !!fixed,
    settings: { exchangeRate: fixed, updatedAt: (parsed && parsed.updatedAt) || '' }
  };
}

function posCurrencyCentralExchangeRatePOS(){
  try{
    const state = posCurrencyCentralStatePOS();
    const n = cashV2FxNorm(state && (state.exchangeRate != null ? state.exchangeRate : state.settings && state.settings.exchangeRate));
    return n == null ? null : n;
  }catch(_){
    return null;
  }
}

function posCurrencyCentralExchangeRateFixedPOS(){
  const n = posCurrencyCentralExchangeRatePOS();
  return n == null ? '' : formatExchangeRate2(n);
}

function posCurrencyCentralStatusTextPOS(){
  const fixed = posCurrencyCentralExchangeRateFixedPOS();
  return fixed ? ('Desde Moneda: ' + fixed) : POS_CURRENCY_TC_REQUIRED_MSG;
}

function posCurrencyRequireCentralExchangeRatePOS(){
  const rate = posCurrencyCentralExchangeRatePOS();
  if (rate == null) return { ok:false, rate:null, fixed:'', msg: POS_CURRENCY_TC_REQUIRED_MSG };
  return { ok:true, rate, fixed: formatExchangeRate2(rate), msg: 'Desde Moneda: ' + formatExchangeRate2(rate) };
}

let __A33_POS_EVENT_FX_DRAFT = null;

function setEventFxDraftPOS(eventId, value){
  const eid = String(eventId == null ? '' : eventId).trim();
  const rate = normalizeExchangeRate(value);
  if (!eid || rate == null) return null;
  const fixed = formatExchangeRate2(rate);
  __A33_POS_EVENT_FX_DRAFT = { eventId: eid, rate, fixed, ts: Date.now() };
  return fixed;
}

function getEventFxDraftPOS(eventId){
  const eid = String(eventId == null ? '' : eventId).trim();
  const d = __A33_POS_EVENT_FX_DRAFT;
  if (!eid || !d || String(d.eventId) !== eid) return null;
  const age = Date.now() - Number(d.ts || 0);
  if (!Number.isFinite(age) || age < 0 || age > 120000){
    __A33_POS_EVENT_FX_DRAFT = null;
    return null;
  }
  return normalizeExchangeRate(d.rate);
}

function clearEventFxDraftPOS(eventId, value){
  const eid = String(eventId == null ? '' : eventId).trim();
  const d = __A33_POS_EVENT_FX_DRAFT;
  if (!d || (eid && String(d.eventId) !== eid)) return;
  const expected = normalizeExchangeRate(value);
  if (expected == null || normalizeExchangeRate(d.rate) === expected){
    __A33_POS_EVENT_FX_DRAFT = null;
  }
}

async function getCurrentEventForExchangeRatePOS(){
  try{
    const current = await getMeta('currentEventId');
    if (!current) return null;
    const evs = await getAll('events');
    return (Array.isArray(evs) ? evs : []).find(ev => ev && String(ev.id) === String(current)) || null;
  }catch(_){
    return null;
  }
}

async function getActiveEventExchangeRate(){
  try{
    const ev = await getCurrentEventForExchangeRatePOS();
    if (!ev || ev.closedAt) return null;
    return posCurrencyCentralExchangeRatePOS();
  }catch(_){
    return null;
  }
}

async function setEventExchangeRateByIdPOS(eventId, value){
  const rate = normalizeExchangeRate(value);
  const eidNum = Number(eventId);
  if (!Number.isFinite(eidNum) || rate == null) return false;

  const fixed = formatExchangeRate2(rate);

  try{
    if (!db) await openDB();
    const ev = await getOne('events', eidNum);
    if (!ev || typeof ev !== 'object' || ev.closedAt) return false;

    ev[CASHV2_EVENT_FX_PROP] = fixed;
    await put('events', ev);

    try{ cashV2FxSetCached(eidNum, fixed); }catch(_){ }
    try{ clearEventFxDraftPOS(eidNum, fixed); }catch(_){ }
    return true;
  }catch(err){
    console.error('[A33][POS][FX] No se pudo guardar T/C del evento', err);
    return false;
  }
}

async function setActiveEventExchangeRate(value){
  const rate = normalizeExchangeRate(value);
  const central = posCurrencyCentralExchangeRatePOS();
  if (rate == null || central == null) return false;

  const ev = await getCurrentEventForExchangeRatePOS();
  if (!ev || ev.closedAt) return false;

  // El T/C editable vive en Configuración → Moneda; aquí solo se valida que coincida.
  return formatExchangeRate2(rate) === formatExchangeRate2(central);
}

function setSaleExchangeRateStatusPOS(msg, isError){
  const status = document.getElementById('sale-exchange-rate-status');
  const err = document.getElementById('sale-exchange-rate-error');
  const inp = document.getElementById('sale-exchange-rate');
  try{ if (status) status.textContent = isError ? '—' : (msg || '—'); }catch(_){ }
  try{
    if (err){
      err.textContent = isError ? (msg || 'T/C inválido') : '';
      err.style.display = isError ? 'block' : 'none';
    }
  }catch(_){ }
  try{ toggleInvalidBorderPOS(inp, !!isError); }catch(_){ }
}

async function syncExchangeRateInputs(){
  const saleInp = document.getElementById('sale-exchange-rate');
  const saleWrap = document.getElementById('sale-exchange-rate-wrap');
  let ev = null;
  let fixed = '';

  try{
    ev = await getCurrentEventForExchangeRatePOS();
    fixed = posCurrencyCentralExchangeRateFixedPOS();
  }catch(_){
    ev = null;
    fixed = '';
  }

  if (saleInp){
    try{ saleInp.disabled = true; }catch(_){ }
    try{ saleInp.readOnly = true; }catch(_){ }
    try{ saleInp.value = fixed; }catch(_){ }
    try{ saleInp.title = 'T/C central desde Configuración → Moneda'; }catch(_){ }
  }
  if (saleWrap){
    try{ saleWrap.dataset.eventId = ev && ev.id != null ? String(ev.id) : ''; }catch(_){ }
  }

  if (!ev){
    setSaleExchangeRateStatusPOS('Sin evento activo', false);
  } else if (ev.closedAt){
    setSaleExchangeRateStatusPOS('Evento cerrado', false);
  } else if (fixed){
    setSaleExchangeRateStatusPOS('Desde Moneda: ' + fixed, false);
  } else {
    setSaleExchangeRateStatusPOS(POS_CURRENCY_TC_REQUIRED_MSG, true);
  }

  // Mantener coherente el campo existente de Efectivo si está presente en el DOM.
  try{
    const cashInp = document.getElementById('cashv2-fx-input');
    const cashSt = document.getElementById('cashv2-fx-save-status');
    const cashErr = document.getElementById('cashv2-fx-error');
    const cashErrSm = cashErr ? cashErr.querySelector('small') : null;
    if (cashInp){
      cashInp.disabled = true;
      cashInp.readOnly = true;
      cashInp.value = fixed;
      cashInp.title = 'T/C central desde Configuración → Moneda';
    }
    if (cashSt) cashSt.textContent = fixed ? ('Desde Moneda: ' + fixed) : POS_CURRENCY_TC_REQUIRED_MSG;
    if (cashErr) cashErr.style.display = fixed ? 'none' : 'block';
    if (cashErrSm) cashErrSm.textContent = fixed ? '' : POS_CURRENCY_TC_REQUIRED_MSG;
    const cashBtn = document.getElementById('cashv2-btn-save-fx');
    if (cashBtn) cashBtn.disabled = true;
  }catch(_){ }

  // Mantener coherente el campo de Calculadora POS sin convertirlo en otra fuente de verdad.
  try{
    const calcInp = document.getElementById('fx-rate');
    const calcMeta = document.getElementById('fx-meta');
    const calcStatus = document.getElementById('fx-status');
    if (calcInp){
      calcInp.disabled = true;
      calcInp.readOnly = true;
      calcInp.value = fixed;
      calcInp.title = 'T/C central desde Configuración → Moneda';
    }
    if (String(window.__A33_ACTIVE_TAB || '') === 'calculadora'){
      if (calcMeta){
        if (!ev) calcMeta.textContent = 'Sin evento activo · T/C desde Moneda';
        else if (ev.closedAt) calcMeta.textContent = 'Evento cerrado · T/C desde Moneda';
        else calcMeta.textContent = `Evento activo: ${ev.name || 'Sin nombre'} · T/C desde Moneda`;
      }
      if (calcStatus){
        calcStatus.style.display = 'block';
        calcStatus.textContent = fixed ? ('Desde Moneda: ' + fixed) : POS_CURRENCY_TC_REQUIRED_MSG;
      }
    }
  }catch(_){ }

  // Vender: mantener el T/C usado del cobro USD alineado al valor central.
  try{ refreshSaleCashTenderUiPOS({ forceFx:true }); }catch(_){ }
}

function setupSaleExchangeRateUIOnce(){
  const inp = document.getElementById('sale-exchange-rate');
  if (!inp || inp.dataset.ready === '1') return;

  const persist = async ()=>{
    const central = posCurrencyRequireCentralExchangeRatePOS();
    if (!central.ok){
      try{ inp.value = ''; }catch(_){ }
      setSaleExchangeRateStatusPOS(central.msg, true);
      return false;
    }

    try{ inp.value = central.fixed; }catch(_){ }
    setSaleExchangeRateStatusPOS(central.msg, false);
    try{ await syncExchangeRateInputs(); }catch(_){ }
    return true;
  };

  inp.addEventListener('input', ()=>{
    const central = posCurrencyRequireCentralExchangeRatePOS();
    try{ inp.value = central.fixed || ''; }catch(_){ }
    setSaleExchangeRateStatusPOS(central.msg, !central.ok);
    try{ refreshSaleCashTenderUiPOS({ forceFx:true }); }catch(_){ }
  });

  inp.addEventListener('blur', ()=>{ persist().catch(err=>console.error('[A33][POS][FX] blur save', err)); });
  inp.addEventListener('change', ()=>{ persist().catch(err=>console.error('[A33][POS][FX] change save', err)); });
  inp.addEventListener('keydown', (ev)=>{
    if (ev && ev.key === 'Enter'){
      try{ ev.preventDefault(); }catch(_){ }
      try{ inp.blur(); }catch(_){ }
    }
  });

  inp.dataset.ready = '1';
}


// --- POS Vender — Cobro en USD con vuelto en C$ (Etapa 4/5)
function saleTenderRound2POS(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function saleTenderFmt2POS(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return saleTenderRound2POS(n).toFixed(2);
}

function getSaleTenderTotalPOS(){
  try{
    const el = document.getElementById('sale-total');
    const n = parseNumPOS(el ? el.value : '', 0);
    return Number.isFinite(n) ? saleTenderRound2POS(n) : 0;
  }catch(_){ return 0; }
}

function isSalePaymentCashPOS(){
  try{ return normalizePaymentMethodPOS(document.getElementById('sale-payment')?.value || 'efectivo') === 'efectivo'; }catch(_){ return true; }
}

function getSaleCashTenderModePOS(){
  try{
    const sel = document.getElementById('sale-cash-mode');
    const v = sel ? String(sel.value || 'nio') : 'nio';
    return v === 'usd_change_nio' ? 'usd_change_nio' : 'nio';
  }catch(_){ return 'nio'; }
}

function setSaleCashTenderStatusPOS(msg, isError){
  const el = document.getElementById('sale-cash-tender-status');
  try{
    if (el){
      el.textContent = msg || '';
      el.classList.toggle('warn', !!isError);
      el.classList.toggle('muted', !isError);
    }
  }catch(_){ }
}

function clearSaleCashTenderInvalidPOS(){
  ['sale-cash-fx-used','sale-cash-usd-received','sale-cash-equivalent','sale-cash-change'].forEach(id=>{
    try{ toggleInvalidBorderPOS(document.getElementById(id), false); }catch(_){ }
  });
}

function refreshSaleCashTenderUiPOS(opts){
  opts = opts || {};
  const card = document.getElementById('sale-cash-tender-card');
  const fields = document.getElementById('sale-cash-usd-fields');
  const fxUsed = document.getElementById('sale-cash-fx-used');
  if (!card) return;

  const isCash = isSalePaymentCashPOS();
  try{ card.style.display = isCash ? 'block' : 'none'; }catch(_){ }
  if (!isCash){
    try{ if (fields) fields.style.display = 'none'; }catch(_){ }
    setSaleCashTenderStatusPOS('', false);
    clearSaleCashTenderInvalidPOS();
    return;
  }

  const mode = getSaleCashTenderModePOS();
  const isUsd = mode === 'usd_change_nio';
  try{ if (fields) fields.style.display = isUsd ? 'grid' : 'none'; }catch(_){ }

  if (fxUsed){
    const saleFx = posCurrencyCentralExchangeRatePOS();
    if (opts.forceFx || document.activeElement !== fxUsed) fxUsed.value = saleFx != null ? formatExchangeRate2(saleFx) : '';
  }

  if (!isUsd){
    setSaleCashTenderStatusPOS('Se registrará como efectivo recibido en C$.', false);
    clearSaleCashTenderInvalidPOS();
    return;
  }

  updateSaleCashTenderComputedPOS();
}

function updateSaleCashTenderComputedPOS(){
  const mode = getSaleCashTenderModePOS();
  const isCash = isSalePaymentCashPOS();
  if (!isCash || mode !== 'usd_change_nio') return;

  const total = getSaleTenderTotalPOS();
  const fx = posCurrencyCentralExchangeRatePOS();
  const usdRaw = parseNumPOS(document.getElementById('sale-cash-usd-received')?.value || '', NaN);
  const usd = Number.isFinite(usdRaw) ? saleTenderRound2POS(usdRaw) : NaN;
  const eq = (fx != null && Number.isFinite(usd)) ? saleTenderRound2POS(usd * fx) : NaN;
  const change = Number.isFinite(eq) ? saleTenderRound2POS(eq - total) : NaN;

  try{
    const fxEl = document.getElementById('sale-cash-fx-used');
    if (fxEl) fxEl.value = fx != null ? formatExchangeRate2(fx) : '';
  }catch(_){ }
  try{ const el = document.getElementById('sale-cash-equivalent'); if (el) el.value = Number.isFinite(eq) ? saleTenderFmt2POS(eq) : ''; }catch(_){ }
  try{ const el = document.getElementById('sale-cash-change'); if (el) el.value = Number.isFinite(change) ? saleTenderFmt2POS(Math.max(0, change)) : ''; }catch(_){ }

  clearSaleCashTenderInvalidPOS();
  if (fx == null){
    setSaleCashTenderStatusPOS(POS_CURRENCY_TC_REQUIRED_MSG, true);
    try{ toggleInvalidBorderPOS(document.getElementById('sale-cash-fx-used'), true); }catch(_){ }
  } else if (!Number.isFinite(usd) || usd <= 0){
    setSaleCashTenderStatusPOS('Ingresa el monto recibido en USD.', false);
  } else if (change < -0.000001){
    setSaleCashTenderStatusPOS('El USD recibido no cubre el total de la venta.', true);
    try{ toggleInvalidBorderPOS(document.getElementById('sale-cash-usd-received'), true); }catch(_){ }
  } else {
    setSaleCashTenderStatusPOS('Equivalente C$ ' + saleTenderFmt2POS(eq) + ' · Vuelto C$ ' + saleTenderFmt2POS(change), false);
  }
}

function resetSaleCashTenderPOS(){
  try{ const sel = document.getElementById('sale-cash-mode'); if (sel) sel.value = 'nio'; }catch(_){ }
  try{ const usd = document.getElementById('sale-cash-usd-received'); if (usd) usd.value = ''; }catch(_){ }
  try{ const eq = document.getElementById('sale-cash-equivalent'); if (eq) eq.value = ''; }catch(_){ }
  try{ const ch = document.getElementById('sale-cash-change'); if (ch) ch.value = ''; }catch(_){ }
  clearSaleCashTenderInvalidPOS();
  refreshSaleCashTenderUiPOS({ forceFx:true });
}

function validateSaleCashTenderPOS({ payment, total, courtesy, isReturn }){
  const pay = normalizePaymentMethodPOS(payment || 'efectivo');
  const saleTotal = saleTenderRound2POS(total);

  if (pay !== 'efectivo') return { ok:true, tender:null };

  const mode = getSaleCashTenderModePOS();
  if (mode !== 'usd_change_nio'){
    return {
      ok:true,
      tender:{
        cashTenderMode:'NIO_ONLY',
        cashTenderLabel:'C$ solamente',
        cashPaymentCurrency:'NIO',
        cashExpectedDelta:{ NIO: saleTotal, USD: 0 },
        cashBreakdown:{
          mode:'NIO_ONLY',
          totalNIO: saleTotal,
          receivedNIO: saleTotal,
          receivedUSD: 0,
          changeNIO: 0,
          changeCurrency:'NIO',
          expectedBoxByCurrency:{ NIO: saleTotal, USD: 0 }
        }
      }
    };
  }

  if (courtesy || isReturn || !(saleTotal > 0)){
    return { ok:false, msg:'El cobro USD con vuelto C$ solo aplica a ventas normales con total mayor que 0.' };
  }

  const fx = posCurrencyCentralExchangeRatePOS();
  if (fx == null){
    try{ toggleInvalidBorderPOS(document.getElementById('sale-cash-fx-used'), true); }catch(_){ }
    return { ok:false, msg: POS_CURRENCY_TC_REQUIRED_MSG };
  }

  const usdRaw = parseNumPOS(document.getElementById('sale-cash-usd-received')?.value || '', NaN);
  const usd = Number.isFinite(usdRaw) ? saleTenderRound2POS(usdRaw) : NaN;
  if (!Number.isFinite(usd) || usd <= 0){
    try{ toggleInvalidBorderPOS(document.getElementById('sale-cash-usd-received'), true); }catch(_){ }
    return { ok:false, msg:'Ingresa el monto recibido en USD.' };
  }

  const equivalentC = saleTenderRound2POS(usd * fx);
  const changeC = saleTenderRound2POS(equivalentC - saleTotal);
  if (changeC < -0.000001){
    try{ toggleInvalidBorderPOS(document.getElementById('sale-cash-usd-received'), true); }catch(_){ }
    return { ok:false, msg:'El monto recibido en USD no cubre el total de la venta.' };
  }

  const changeSafe = saleTenderRound2POS(Math.max(0, changeC));
  return {
    ok:true,
    tender:{
      cashTenderMode:'USD_CHANGE_NIO',
      cashTenderLabel:'USD con vuelto en C$',
      cashPaymentCurrency:'USD',
      fxUsed: fx,
      exchangeRateUsed: fx,
      usdReceived: usd,
      receivedUSD: usd,
      equivalentC,
      equivalentNIO: equivalentC,
      changeC: changeSafe,
      changeNIO: changeSafe,
      changeCurrency:'NIO',
      cashExpectedDelta:{ NIO: -changeSafe, USD: usd },
      cashBreakdown:{
        mode:'USD_CHANGE_NIO',
        totalNIO: saleTotal,
        fxUsed: fx,
        exchangeRateUsed: fx,
        receivedUSD: usd,
        equivalentNIO: equivalentC,
        changeNIO: changeSafe,
        changeCurrency:'NIO',
        expectedBoxByCurrency:{ NIO: -changeSafe, USD: usd }
      }
    }
  };
}

function applySaleCashTenderToRecordPOS(saleRecord, tender){
  if (!saleRecord || !tender) return saleRecord;
  try{
    saleRecord.cashTenderMode = tender.cashTenderMode;
    saleRecord.cashTenderLabel = tender.cashTenderLabel;
    saleRecord.cashPaymentCurrency = tender.cashPaymentCurrency;
    saleRecord.cashExpectedDelta = tender.cashExpectedDelta;
    saleRecord.cashBreakdown = tender.cashBreakdown;
    if (tender.fxUsed != null) saleRecord.fxUsed = tender.fxUsed;
    if (tender.exchangeRateUsed != null) saleRecord.exchangeRateUsed = tender.exchangeRateUsed;
    if (tender.usdReceived != null) saleRecord.usdReceived = tender.usdReceived;
    if (tender.receivedUSD != null) saleRecord.receivedUSD = tender.receivedUSD;
    if (tender.equivalentC != null) saleRecord.equivalentC = tender.equivalentC;
    if (tender.equivalentNIO != null) saleRecord.equivalentNIO = tender.equivalentNIO;
    if (tender.changeC != null) saleRecord.changeC = tender.changeC;
    if (tender.changeNIO != null) saleRecord.changeNIO = tender.changeNIO;
    if (tender.changeCurrency != null) saleRecord.changeCurrency = tender.changeCurrency;
  }catch(_){ }
  return saleRecord;
}

function getSaleCashExpectedDeltaPOS(sale){
  try{
    if (!sale || typeof sale !== 'object') return { NIO:0, USD:0 };
    const pay = normalizePaymentMethodPOS(sale.payment || '');
    if (pay !== 'efectivo') return { NIO:0, USD:0 };

    const direct = sale.cashExpectedDelta;
    if (direct && typeof direct === 'object'){
      const n = saleTenderRound2POS(Number(direct.NIO || direct.nio || 0));
      const u = saleTenderRound2POS(Number(direct.USD || direct.usd || 0));
      return { NIO:n, USD:u };
    }

    const bd = sale.cashBreakdown;
    const bx = bd && bd.expectedBoxByCurrency;
    if (bx && typeof bx === 'object'){
      const n = saleTenderRound2POS(Number(bx.NIO || bx.nio || 0));
      const u = saleTenderRound2POS(Number(bx.USD || bx.usd || 0));
      return { NIO:n, USD:u };
    }

    const mode = String(sale.cashTenderMode || '').toUpperCase();
    if (mode === 'USD_CHANGE_NIO'){
      const change = saleTenderRound2POS(Number(sale.changeNIO ?? sale.changeC ?? 0));
      const usd = saleTenderRound2POS(Number(sale.receivedUSD ?? sale.usdReceived ?? 0));
      return { NIO:-Math.max(0, change), USD:Math.max(0, usd) };
    }

    let t = Number(sale.total != null ? sale.total : 0);
    if (!Number.isFinite(t)) t = 0;
    return { NIO:saleTenderRound2POS(t), USD:0 };
  }catch(_){
    return { NIO:0, USD:0 };
  }
}

function getSalePaymentLabelPOS(sale, bankMap){
  try{
    if (!sale) return '';
    const payment = normalizePaymentMethodPOS(sale.payment || '');
    if (payment === 'efectivo'){
      if (String(sale.cashTenderMode || '').toUpperCase() === 'USD_CHANGE_NIO') return 'Efectivo · USD';
      return 'Efectivo';
    }
    if (payment === 'transferencia') return 'Transferencia · ' + getSaleBankLabel(sale, bankMap);
    if (payment === 'tarjeta') return 'Tarjeta · ' + getSaleBankLabel(sale, bankMap);
    return getPaymentMethodLabelPOS(payment);
  }catch(_){ return getPaymentMethodLabelPOS(sale && sale.payment || ''); }
}


function getSaleCashTenderPartsPOS(sale){
  const out = { fx:'', usd:'', change:'', equivalent:'', text:'' };
  try{
    if (!sale || typeof sale !== 'object') return out;
    if (normalizePaymentMethodPOS(sale.payment || '') !== 'efectivo') return out;
    const mode = String(sale.cashTenderMode || '').toUpperCase();
    const usdRaw = Number(sale.usdReceived ?? sale.receivedUSD ?? (sale.cashBreakdown && sale.cashBreakdown.receivedUSD));
    if (mode !== 'USD_CHANGE_NIO' && !(Number.isFinite(usdRaw) && usdRaw > 0)) return out;

    const fxRaw = Number(sale.fxUsed ?? sale.exchangeRateUsed ?? (sale.cashBreakdown && (sale.cashBreakdown.fxUsed ?? sale.cashBreakdown.exchangeRateUsed)));
    const eqRaw = Number(sale.equivalentC ?? sale.equivalentNIO ?? (sale.cashBreakdown && sale.cashBreakdown.equivalentNIO));
    const chRaw = Number(sale.changeC ?? sale.changeNIO ?? (sale.cashBreakdown && sale.cashBreakdown.changeNIO));

    out.fx = Number.isFinite(fxRaw) && fxRaw > 0 ? formatExchangeRate2(fxRaw) : '';
    out.usd = Number.isFinite(usdRaw) && usdRaw > 0 ? saleTenderFmt2POS(usdRaw) : '';
    out.change = Number.isFinite(chRaw) ? saleTenderFmt2POS(Math.max(0, chRaw)) : '';
    out.equivalent = Number.isFinite(eqRaw) ? saleTenderFmt2POS(eqRaw) : '';

    const parts = [];
    if (out.usd) parts.push('USD ' + out.usd);
    if (out.change) parts.push('Vuelto C$ ' + out.change);
    if (out.fx) parts.push('T/C ' + out.fx);
    if (out.equivalent) parts.push('Equiv. C$ ' + out.equivalent);
    out.text = parts.join(' · ');
  }catch(_){ }
  return out;
}

function getSaleCashTenderDetailTextPOS(sale){
  try{ return getSaleCashTenderPartsPOS(sale).text || ''; }catch(_){ return ''; }
}

function setupSaleCashTenderUIOnce(){
  const card = document.getElementById('sale-cash-tender-card');
  if (!card || card.dataset.ready === '1') return;
  const mode = document.getElementById('sale-cash-mode');
  const usd = document.getElementById('sale-cash-usd-received');
  if (mode) mode.addEventListener('change', ()=> refreshSaleCashTenderUiPOS({ forceFx:true }));
  if (usd){
    usd.addEventListener('input', updateSaleCashTenderComputedPOS);
    usd.addEventListener('blur', ()=>{
      const n = parseNumPOS(usd.value || '', NaN);
      if (Number.isFinite(n) && n > 0) usd.value = saleTenderFmt2POS(n);
      updateSaleCashTenderComputedPOS();
    });
  }
  card.dataset.ready = '1';
  refreshSaleCashTenderUiPOS({ forceFx:true });
}

function cashV2InitInitialUIOnce(){
  const card = document.getElementById('cashv2-initial-card');
  if (!card) return;
  if (card.dataset.ready === '1') return;

  function build(ccy, tableId){
    const denoms = CASHV2_DENOMS[ccy] || [];
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    tbody.innerHTML = denoms.map(d=>{
      const k = String(d);
      const sym = (ccy === 'NIO') ? 'C$' : '$';
      return `\n<tr>\n  <td class=\"denom\"><b>${sym} ${k}</b></td>\n  <td>\n    <input type=\"number\" min=\"0\" step=\"1\" inputmode=\"numeric\" pattern=\"[0-9]*\"\n      class=\"cashv2-denom-input\"\n      data-cashv2-initial=\"1\" data-ccy=\"${ccy}\" data-denom=\"${k}\"\n      id=\"cashv2-initial-${ccy}-${k}\" placeholder=\"\" value=\"\"\n    >\n  </td>\n  <td class=\"sub\"><span id=\"cashv2-sub-${ccy}-${k}\">0</span></td>\n</tr>`;
    }).join('');
  }

  build('NIO', 'cashv2-table-initial-nio');
  build('USD', 'cashv2-table-initial-usd');

  // Totales en vivo (sin logs por input)
  card.addEventListener('input', (e)=>{
    const t = e && e.target;
    if (!t || t.getAttribute('data-cashv2-initial') !== '1') return;
    cashV2UpdateInitialTotals();
    try{ cashV2UpdateCloseSummary(); }catch(_){ }
  });

  // Normalizar al salir del input
  card.addEventListener('focusout', (e)=>{
    const t = e && e.target;
    if (!t || t.getAttribute('data-cashv2-initial') !== '1') return;
    const raw = (t.value != null) ? String(t.value) : '';
    if (raw.trim() === ''){
      try{ t.value = ''; }catch(_){ }
      cashV2UpdateInitialTotals();
      try{ cashV2UpdateCloseSummary(); }catch(_){ }
      return;
    }
    const n = cashV2NormCount(raw);
    t.value = String(n);
    cashV2UpdateInitialTotals();
    try{ cashV2UpdateCloseSummary(); }catch(_){ }
  });

  const btn = document.getElementById('cashv2-btn-save-initial');
  if (btn){
    btn.addEventListener('click', async ()=>{
      const eid = String(card.dataset.eventId || '').trim();
      const dk = String(card.dataset.dayKey || '').trim();
      if (!eid || !dk) return;

      const initial = cashV2ReadInitialFromDom(true);
      try{
        const rec = await cashV2Ensure(eid, dk);
        rec.initial = initial;
        await cashV2RefreshPhysicalSalesOnRecordPOS(rec, eid, dk);
        const saved = await cashV2Save(rec);

        const nio = (saved && saved.initial && saved.initial.NIO && Number(saved.initial.NIO.total)) || 0;
        const usd = (saved && saved.initial && saved.initial.USD && Number(saved.initial.USD.total)) || 0;
        if (typeof window !== 'undefined' && window.A33_DEBUG_CASHV2) console.info(`[A33][CASHv2] initial save ${eid} ${dk} totals NIO=${nio} USD=${usd}`);

        cashV2SetLastRec(saved);
        cashV2ApplyInitialToDom(saved.initial);
        try{ cashV2UpdateCloseSummary(saved); }catch(_){ }
        try{ cashV2UpdateCloseEligibility(saved); }catch(_){ }
        const st = document.getElementById('cashv2-initial-save-status');
        if (st){
          st.textContent = 'Guardado';
          setTimeout(()=>{ try{ st.textContent = ''; }catch(_){ } }, 2200);
        }
      }catch(err){
        console.error('[A33][CASHv2] initial save error', err);
        const st = document.getElementById('cashv2-initial-save-status');
        if (st){ st.textContent = 'Error'; setTimeout(()=>{ try{ st.textContent = ''; }catch(_){ } }, 2600); }
      }
    });
  }

  card.dataset.ready = '1';
  cashV2UpdateInitialTotals();
}

function cashV2ReadInitialFromDom(updateUi){
  const card = document.getElementById('cashv2-initial-card');
  const initial = cashV2DefaultInitial();
  if (!card) return initial;

  // Leer counts
  const inputs = card.querySelectorAll('input[data-cashv2-initial="1"]');
  inputs.forEach(inp=>{
    const ccy = String(inp.dataset.ccy || '').trim();
    const denom = String(inp.dataset.denom || '').trim();
    if (!ccy || !denom || !initial[ccy]) return;
    initial[ccy].denomCounts[denom] = cashV2CountToStore(inp.value);
  });

  // Calcular subtotales + totales
  for (const ccy of ['NIO','USD']){
    let total = 0;
    for (const d of (CASHV2_DENOMS[ccy] || [])){
      const k = String(d);
      const cnt = cashV2NormCount(initial[ccy].denomCounts[k]);
      const sub = Number(d) * cnt;
      total += sub;
      if (updateUi){
        const elSub = document.getElementById(`cashv2-sub-${ccy}-${k}`);
        if (elSub) elSub.textContent = cashV2FmtInt(sub);
      }
    }
    initial[ccy].total = cashV2Round2Money(total);
    if (updateUi){
      const elTot = document.getElementById(ccy === 'NIO' ? 'cashv2-total-nio' : 'cashv2-total-usd');
      if (elTot) elTot.textContent = cashV2FmtInt(total);
    }
  }

  return initial;
}

function cashV2UpdateInitialTotals(){
  cashV2ReadInitialFromDom(true);
}

function cashV2ApplyInitialToDom(initial){
  const card = document.getElementById('cashv2-initial-card');
  if (!card) return;
  const v = cashV2CoerceInitial(initial);
  for (const ccy of ['NIO','USD']){
    for (const d of (CASHV2_DENOMS[ccy] || [])){
      const k = String(d);
      const inp = document.getElementById(`cashv2-initial-${ccy}-${k}`);
      if (inp) inp.value = cashV2CountDomValue(v[ccy].denomCounts[k]);
    }
  }
  cashV2UpdateInitialTotals();
}

function cashV2SetInitialEnabled(enabled){
  const card = document.getElementById('cashv2-initial-card');
  if (!card) return;
  const en = !!enabled;
  card.querySelectorAll('input[data-cashv2-initial="1"]').forEach(inp=>{ inp.disabled = !en; });
  const btn = document.getElementById('cashv2-btn-save-initial');
  if (btn) btn.disabled = !en;
}

// --- POS: Efectivo v2 — “Ventas en efectivo” (C$ / USD físico) desde POS (read-only) por evento/día
let __CASHV2_CASHSALES_C = 0;
let __CASHV2_CASHSALES_USD = 0;

function cashV2SetCashSalesC(v){
  let n = Number(v || 0);
  if (!Number.isFinite(n)) n = 0;
  n = Math.round(n * 100) / 100;
  if (!Number.isFinite(n)) n = 0;
  __CASHV2_CASHSALES_C = n;
}

function cashV2GetCashSalesC(){
  return Number.isFinite(__CASHV2_CASHSALES_C) ? __CASHV2_CASHSALES_C : 0;
}

function cashV2SetCashSalesUSD(v){
  let n = Number(v || 0);
  if (!Number.isFinite(n)) n = 0;
  n = Math.round(n * 100) / 100;
  if (!Number.isFinite(n)) n = 0;
  __CASHV2_CASHSALES_USD = n;
}

function cashV2GetCashSalesUSD(){
  return Number.isFinite(__CASHV2_CASHSALES_USD) ? __CASHV2_CASHSALES_USD : 0;
}

function cashV2ApplyCashSalesToDom(amount, usdAmount){
  const line = document.getElementById('cashv2-cashsales-line');
  const el = document.getElementById('cashv2-cashsales');
  if (!line || !el) return;

  if (amount == null){
    try{ line.style.display = 'none'; }catch(_){ }
    try{ el.textContent = 'C$ 0.00'; }catch(_){ }
    try{ cashV2SetCashSalesC(0); cashV2SetCashSalesUSD(0); }catch(_){ }
    return;
  }

  let n = Number(amount);
  if (!Number.isFinite(n)) n = 0;
  let u = Number(usdAmount || 0);
  if (!Number.isFinite(u)) u = 0;
  try{
    el.textContent = 'C$ ' + fmt(n) + (Math.abs(u) > 0.000001 ? (' · USD ' + fmt(u)) : '');
  }catch(_){ el.textContent = 'C$ 0.00'; }
  try{ cashV2SetCashSalesC(n); cashV2SetCashSalesUSD(u); }catch(_){ }
  try{ line.style.display = 'block'; }catch(_){ }
}

async function cashV2GetSalesByEventPOS(eventId){
  const eidStr = String(eventId || '').trim();
  if (!eidStr) return [];
  try{ if (!db) await openDB(); }catch(_){ }

  const eidNum = Number(eidStr);
  const keys = [];
  if (Number.isFinite(eidNum)) keys.push(eidNum);
  keys.push(eidStr);

  const uniq = [];
  const seen = new Set();
  for (const k of keys){
    const sk = (typeof k === 'number') ? ('n:' + String(k)) : ('s:' + String(k));
    if (seen.has(sk)) continue;
    seen.add(sk);
    uniq.push(k);
  }

  // Fast path: index by_event
  for (const key of uniq){
    const arr = await new Promise((resolve)=>{
      try{
        if (!db){ resolve(null); return; }
        const tr = db.transaction(['sales'], 'readonly');
        const store = tr.objectStore('sales');
        let idx = null;
        try{ idx = store.index('by_event'); }catch(_){ idx = null; }
        if (!idx){ resolve(null); return; }
        const req = idx.getAll(IDBKeyRange.only(key));
        req.onsuccess = ()=> resolve(req.result || []);
        req.onerror = ()=> resolve(null);
      }catch(_){ resolve(null); }
    });
    if (Array.isArray(arr) && arr.length) return arr;
  }

  // Fallback: getAll + filter
  try{
    const all = await getAll('sales');
    return (Array.isArray(all) ? all : []).filter(s => s && String(s.eventId) === eidStr);
  }catch(_){
    return [];
  }
}

async function cashV2ComputeCashSalesPhysicalPOS(eventId, dayKey){
  const eidStr = String(eventId || '').trim();
  if (!eidStr) return { NIO:0, USD:0, grossNIO:0, changeNIO:0 };
  const dk = safeYMD(dayKey);
  let sumN = 0;
  let sumU = 0;
  let grossN = 0;
  let changeN = 0;

  let sales = [];
  try{ sales = await cashV2GetSalesByEventPOS(eidStr); }catch(_){ sales = []; }

  for (const s of (sales || [])){
    if (!s || typeof s !== 'object') continue;
    if (safeYMD(s.date || '') !== dk) continue;
    const pay = normalizePaymentMethodPOS(s.payment || '');
    if (pay !== 'efectivo') continue;
    try{ if (typeof isCourtesySalePOS === 'function' && isCourtesySalePOS(s)) continue; }catch(_){ }

    let t = Number(s.total != null ? s.total : 0);
    if (!Number.isFinite(t)) t = 0;
    grossN += t;

    const delta = getSaleCashExpectedDeltaPOS(s);
    const dn = Number(delta && delta.NIO);
    const du = Number(delta && delta.USD);
    sumN += Number.isFinite(dn) ? dn : 0;
    sumU += Number.isFinite(du) ? du : 0;
    try{
      const ch = Number(s.changeNIO ?? s.changeC ?? (s.cashBreakdown && s.cashBreakdown.changeNIO) ?? 0);
      if (Number.isFinite(ch) && ch > 0) changeN += ch;
    }catch(_){ }
  }

  return {
    NIO: cashV2Round2Money(sumN),
    USD: cashV2Round2Money(sumU),
    grossNIO: cashV2Round2Money(grossN),
    changeNIO: cashV2Round2Money(changeN)
  };
}

async function cashV2ComputeCashSalesC(eventId, dayKey){
  const r = await cashV2ComputeCashSalesPhysicalPOS(eventId, dayKey);
  return cashV2Round2Money(r && r.NIO);
}

async function cashV2ComputeCashSalesUSD(eventId, dayKey){
  const r = await cashV2ComputeCashSalesPhysicalPOS(eventId, dayKey);
  return cashV2Round2Money(r && r.USD);
}

async function cashV2ReadEventCashSalesPreparedPOS(eventId, dayKey){
  const eid = String(eventId || '').trim();
  const dk = safeYMD(dayKey);
  const fx = eid ? posCurrencyCentralExchangeRatePOS() : null;
  const phys = eid ? await cashV2ComputeCashSalesPhysicalPOS(eid, dk) : { NIO:0, USD:0, grossNIO:0, changeNIO:0 };

  return {
    eventId: eid,
    dayKey: dk,
    fx: fx != null ? cashV2FxFmt2(fx) : '',
    cashSalesC: cashV2Round2Money(phys.NIO),
    cashSalesUSD: cashV2Round2Money(phys.USD),
    grossCashSalesC: cashV2Round2Money(phys.grossNIO),
    changeC: cashV2Round2Money(phys.changeNIO),
    mixedCashReady: true
  };
}
try{ window.cashV2ReadEventCashSalesPreparedPOS = cashV2ReadEventCashSalesPreparedPOS; }catch(_){ }


async function cashV2RefreshPhysicalSalesOnRecordPOS(rec, eventId, dayKey, opts){
  const r = (rec && typeof rec === 'object') ? rec : null;
  if (!r) return rec;
  try{
    const status = cashV2NormStatus(r.status);
    const allowClosed = !!(opts && opts.allowClosed);
    // Cierres ya guardados quedan protegidos: no recalcular snapshots/cierres históricos.
    if (status === 'CLOSED' && !allowClosed) return r;

    const eid = String(eventId || r.eventId || '').trim();
    const dk = safeYMD(dayKey || r.dayKey || '');
    if (!eid || !dk) return r;

    const phys = await cashV2ComputeCashSalesPhysicalPOS(eid, dk);
    r.cashSalesC = cashV2Round2Money(phys && phys.NIO);
    r.cashSalesUSD = cashV2Round2Money(phys && phys.USD);
    r.cashSalesGrossC = cashV2Round2Money(phys && phys.grossNIO);
    r.cashSalesChangeC = cashV2Round2Money(phys && phys.changeNIO);
    r.cashSalesPhysicalUpdatedAt = Date.now();
  }catch(_){ }
  return r;
}
try{ window.cashV2RefreshPhysicalSalesOnRecordPOS = cashV2RefreshPhysicalSalesOnRecordPOS; }catch(_){ }

// --- POS: Efectivo v2 — Movimientos (Entradas/Salidas/Ajuste) por moneda — Etapa 4
function cashV2NormAmountInt(v, opts){
  const allowNeg = !!(opts && opts.allowNegative);
  let n = Number(v);
  if (!Number.isFinite(n)) return 0;
  n = Math.trunc(n);
  if (!allowNeg && n < 0) n = Math.abs(n);
  // En ajuste se permite negativo. 0 se considera inválido para agregar movimiento.
  return n;
}

function cashV2NewMovementId(){
  return 'M-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2,10);
}

const CASHV2_OPERATIONAL_CLASSES = Object.freeze({
  ADDITIONAL_INCOME: 'ADDITIONAL_INCOME',
  EXPENSE: 'EXPENSE',
  CASH_IN: 'CASH_IN',
  CASH_OUT: 'CASH_OUT',
  UNCLASSIFIED: 'UNCLASSIFIED'
});
const CASHV2_OPERATIONAL_LABELS = Object.freeze({
  ADDITIONAL_INCOME: 'Ingreso Adicional',
  EXPENSE: 'Gasto',
  CASH_IN: 'Entrada de efectivo / fondo',
  CASH_OUT: 'Salida de efectivo / retiro',
  UNCLASSIFIED: 'No clasificado'
});

function cashV2NormalizeOperationalClass(value, fallback){
  const fb = fallback || CASHV2_OPERATIONAL_CLASSES.UNCLASSIFIED;
  const raw = String(value || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\-]+/g, '_');
  if (!raw) return fb;
  if (raw === 'ADDITIONAL_INCOME' || raw === 'INGRESO_ADICIONAL' || raw === 'INGRESOS_ADICIONALES' || raw === 'OTHER_INCOME') return CASHV2_OPERATIONAL_CLASSES.ADDITIONAL_INCOME;
  if (raw === 'EXPENSE' || raw === 'GASTO' || raw === 'EGRESO_OPERATIVO') return CASHV2_OPERATIONAL_CLASSES.EXPENSE;
  if (raw === 'CASH_IN' || raw === 'ENTRADA_FONDO' || raw === 'ENTRADA_DE_EFECTIVO_FONDO' || raw === 'ENTRADA_EFECTIVO_FONDO' || raw === 'FONDO' || raw === 'ENTRADA') return CASHV2_OPERATIONAL_CLASSES.CASH_IN;
  if (raw === 'CASH_OUT' || raw === 'SALIDA_RETIRO' || raw === 'SALIDA_DE_EFECTIVO_RETIRO' || raw === 'SALIDA_EFECTIVO_RETIRO' || raw === 'RETIRO' || raw === 'SALIDA') return CASHV2_OPERATIONAL_CLASSES.CASH_OUT;
  if (raw === 'IN') return CASHV2_OPERATIONAL_CLASSES.ADDITIONAL_INCOME;
  if (raw === 'OUT') return CASHV2_OPERATIONAL_CLASSES.EXPENSE;
  if (raw === 'UNCLASSIFIED' || raw === 'NO_CLASIFICADO' || raw === 'SIN_CLASIFICAR') return CASHV2_OPERATIONAL_CLASSES.UNCLASSIFIED;
  return fb;
}

function cashV2OperationalClassLabel(value){
  const cls = cashV2NormalizeOperationalClass(value);
  return CASHV2_OPERATIONAL_LABELS[cls] || CASHV2_OPERATIONAL_LABELS.UNCLASSIFIED;
}

function cashV2OperationalClassToKind(value){
  const cls = cashV2NormalizeOperationalClass(value);
  if (cls === CASHV2_OPERATIONAL_CLASSES.ADDITIONAL_INCOME || cls === CASHV2_OPERATIONAL_CLASSES.CASH_IN) return 'IN';
  if (cls === CASHV2_OPERATIONAL_CLASSES.EXPENSE || cls === CASHV2_OPERATIONAL_CLASSES.CASH_OUT) return 'OUT';
  return 'ADJUST';
}

function cashV2OperationalClassFromKind(kind){
  const k = String(kind || '').trim().toUpperCase();
  if (k === 'IN') return CASHV2_OPERATIONAL_CLASSES.ADDITIONAL_INCOME;
  if (k === 'OUT') return CASHV2_OPERATIONAL_CLASSES.EXPENSE;
  return CASHV2_OPERATIONAL_CLASSES.UNCLASSIFIED;
}

function cashV2MovementKindToUi(kind){
  const k = String(kind || '').trim().toUpperCase();
  // Etapa 2/7: 3 tipos canónicos
  if (k === 'IN') return { text:'Ingreso', sign:+1 };
  if (k === 'OUT') return { text:'Egreso', sign:-1 };
  if (k === 'ADJUST') return { text:'Ajuste', sign:+1 };
  // Compat: formas antiguas (si existen en datos viejos)
  if (k === 'ADJUST_IN') return { text:'Ajuste', sign:+1 };
  if (k === 'ADJUST_OUT') return { text:'Ajuste', sign:-1 };
  return { text: (k || 'Mov'), sign: 0 };
}

function cashV2NetForCurrency(movements, currency){
  const ccy = String(currency || '').trim().toUpperCase();
  let net = 0;
  const arr = Array.isArray(movements) ? movements : [];
  for (const m of arr){
    if (!m || typeof m !== 'object') continue;
    if (String(m.currency || '').trim().toUpperCase() != ccy) continue;
    const k = String(m.kind || '').trim().toUpperCase();
    const allowNeg = (k === 'ADJUST');
    let amt = cashV2NormAmountInt(m.amount, { allowNegative: allowNeg });
    if (!Number.isFinite(amt)) amt = 0;

    if (k === 'IN' || k === 'ADJUST_IN') net += Math.abs(amt);
    else if (k === 'OUT' || k === 'ADJUST_OUT') net -= Math.abs(amt);
    else if (k === 'ADJUST') net += amt;
  }
  return net;
}

function cashV2FmtTime(ts){
  try{
    const d = new Date(Number(ts || 0) || 0);
    if (!isFinite(d)) return '—';
    return d.toLocaleTimeString('es-NI', { hour:'2-digit', minute:'2-digit' });
  }catch(_){
    try{
      const d = new Date(Number(ts || 0) || 0);
      return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }catch(__){
      return '—';
    }
  }
}

function cashV2FmtDateTime(ts){
  try{
    const d = new Date(Number(ts || 0) || 0);
    if (!isFinite(d)) return '—';
    return d.toLocaleString('es-NI', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  }catch(_){
    try{
      const d = new Date(Number(ts || 0) || 0);
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      return `${y}-${m}-${day} ${hh}:${mm}`;
    }catch(__){
      return '—';
    }
  }
}

function cashV2CoerceMovements(movements){
  const arr = Array.isArray(movements) ? movements : [];
  // Mantener solo movimientos mínimamente válidos
  return arr.filter(m => m && typeof m === 'object' && m.kind && m.currency && m.amount != null);
}

function cashV2RenderMovementsUI(cashDay){
  const card = document.getElementById('cashv2-movements-card');
  if (!card) return;

  const list = document.getElementById('cashv2-move-list');
  const empty = document.getElementById('cashv2-move-empty');
  const elNetNio = document.getElementById('cashv2-net-nio');
  const elNetUsd = document.getElementById('cashv2-net-usd');

  // Fecha visible del bloque (readonly)
  try{
    const inpDate = document.getElementById('cashv2-move-date-inline');
    const dk = (cashDay && cashDay.dayKey) ? String(cashDay.dayKey) : String(card.dataset.dayKey || '');
    if (inpDate && dk) inpDate.value = dk;
  }catch(_){ }

  const movs = cashV2CoerceMovements(cashDay && cashDay.movements);
  const netNio = cashV2NetForCurrency(movs, 'NIO');
  const netUsd = cashV2NetForCurrency(movs, 'USD');

  try{ if (elNetNio) elNetNio.textContent = cashV2FmtInt(netNio); }catch(_){ }
  try{ if (elNetUsd) elNetUsd.textContent = cashV2FmtInt(netUsd); }catch(_){ }

  try{ cashV2SetLastRec(cashDay); }catch(_){ }
  try{ cashV2UpdateCloseSummary(cashDay); }catch(_){ }

  if (!list) return;

  if (!movs.length){
    try{ if (empty) empty.style.display = 'block'; }catch(_){ }
    list.innerHTML = '';
    return;
  }

  try{ if (empty) empty.style.display = 'none'; }catch(_){ }

  // Más reciente arriba: ts DESC, desempate estable por id
  const sorted = movs.slice().sort((a,b)=>{
    const dt = (Number(b.ts || 0) - Number(a.ts || 0));
    if (dt) return dt;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });

  list.innerHTML = sorted.map(m => {
    const ccy = String(m.currency || '').trim().toUpperCase();
    const ccyLabel = (ccy === 'NIO') ? 'C$' : 'USD';
    const k = String(m.kind || '').trim().toUpperCase();
    const allowNeg = (k === 'ADJUST');
    let amt = cashV2NormAmountInt(m.amount, { allowNegative: allowNeg });
    if (!Number.isFinite(amt)) amt = 0;
    const ui = cashV2MovementKindToUi(k);
    const opClass = cashV2NormalizeOperationalClass(m.operationalClass || m.clasificacionOperativa || '', cashV2OperationalClassFromKind(k));
    const opLabel = cashV2OperationalClassLabel(opClass);
    let sign = ui.sign > 0 ? '+' : (ui.sign < 0 ? '−' : '');
    if (k === 'ADJUST') sign = (amt < 0 ? '−' : '+');
    const amountText = `${sign} ${ccyLabel} ${cashV2FmtInt(Math.abs(amt))}`.trim();

    const desc = (m.desc != null ? String(m.desc) : (m.note != null ? String(m.note) : '')).trim();
    const descHtml = desc ? `<div class="cashv2-move-note" style="white-space:normal; overflow:visible; text-overflow:unset;">${escapeHtml(desc)}</div>` : '';

    return `<div class="cashv2-move-row">
      <div class="cashv2-move-left">
        <div class="cashv2-move-top">
          <span class="cashv2-mtag"><b>${escapeHtml(cashV2FmtDateTime(m.ts))}</b></span>
          <span class="cashv2-mtag">${escapeHtml(opLabel || ui.text)}</span>
          <span class="cashv2-mtag">${escapeHtml(ccyLabel)}</span>
        </div>
        ${descHtml}
      </div>
      <div class="cashv2-move-amt">${escapeHtml(amountText)}</div>
    </div>`;
  }).join('');
}

function cashV2InitMovementsUIOnce(){
  const card = document.getElementById('cashv2-movements-card');
  if (!card) return;
  if (card.dataset.readyMove === '1') return;

  const inpDate = document.getElementById('cashv2-move-date-inline');
  const selKind = document.getElementById('cashv2-move-kind-inline');
  const selCcy = document.getElementById('cashv2-move-currency-inline');
  const inpAmt = document.getElementById('cashv2-move-amount-inline');
  const inpDesc = document.getElementById('cashv2-move-desc-inline');
  const btnAdd = document.getElementById('cashv2-btn-add-movement');
  const elErr = document.getElementById('cashv2-move-inline-error');
  const elErrSmall = elErr ? elErr.querySelector('small') : null;

  function showErr(msg){
    if (!elErr) return;
    if (!msg){
      try{ elErr.style.display = 'none'; }catch(_){ }
      try{ if (elErrSmall) elErrSmall.textContent = ''; else elErr.textContent = ''; }catch(_){ }
      return;
    }
    try{ elErr.style.display = 'block'; }catch(_){ }
    try{ if (elErrSmall) elErrSmall.textContent = String(msg); else elErr.textContent = String(msg); }catch(_){ }
  }

  function currentCtx(){
    const eid = String(card.dataset.eventId || '').trim();
    const dk = String(card.dataset.dayKey || '').trim();
    return { eid, dk };
  }

  function resetForm(){
    showErr('');
    try{ if (selKind) selKind.value = 'ADDITIONAL_INCOME'; }catch(_){ }
    try{ if (selCcy) selCcy.value = 'NIO'; }catch(_){ }
    try{ if (inpAmt) inpAmt.value = ''; }catch(_){ }
    try{ if (inpDesc) inpDesc.value = ''; }catch(_){ }
    try{
      const { dk } = currentCtx();
      if (inpDate && dk) inpDate.value = dk;
    }catch(_){ }
  }

  async function addMovement(){
    const { eid, dk } = currentCtx();
    if (!eid || !dk){ showErr('Falta evento o día.'); return; }
    if (btnAdd && btnAdd.disabled){ return; }

    const selectedRaw = selKind ? String(selKind.value || '').trim().toUpperCase() : 'ADDITIONAL_INCOME';
    const operationalClass = cashV2NormalizeOperationalClass(selectedRaw, CASHV2_OPERATIONAL_CLASSES.ADDITIONAL_INCOME);
    const kind = cashV2OperationalClassToKind(operationalClass);
    const ccy = selCcy ? String(selCcy.value || '').trim().toUpperCase() : 'NIO';
    const desc = inpDesc ? String(inpDesc.value || '').trim() : '';
    const allowNeg = (kind === 'ADJUST');
    let amt = cashV2NormAmountInt(inpAmt ? inpAmt.value : 0, { allowNegative: allowNeg });
    if (!Number.isFinite(amt)) amt = 0;
    if (!allowNeg) amt = Math.abs(amt);

    if (!(kind === 'IN' || kind === 'OUT' || kind === 'ADJUST')){
      showErr('Clasificación inválida.');
      return;
    }
    if (!(ccy === 'NIO' || ccy === 'USD')){
      showErr('Moneda inválida.');
      return;
    }
    if (!allowNeg){
      if (!amt || amt <= 0){
        showErr('Monto inválido.');
        return;
      }
    }else{
      if (amt == 0){
        showErr('Monto inválido.');
        return;
      }
    }

    try{
      const rec = await cashV2Ensure(eid, dk);

      const movement = {
        id: cashV2NewMovementId(),
        ts: Date.now(),
        kind,
        operationalClass,
        clasificacionOperativa: operationalClass,
        operationalClassLabel: cashV2OperationalClassLabel(operationalClass),
        operationalStage: 'finanzas_tablero_operativo_etapa_2_5',
        currency: ccy,
        amount: amt,
        desc: desc ? desc.slice(0, 120) : ''
      };

      const next = { ...rec };
      const movs = Array.isArray(next.movements) ? next.movements.slice() : [];
      movs.push(movement);
      next.movements = movs;

      await cashV2RefreshPhysicalSalesOnRecordPOS(next, eid, dk);
      const saved = await cashV2Save(next);
      if (typeof window !== 'undefined' && window.A33_DEBUG_CASHV2) console.info(`[A33][CASHv2] movement add: ${kind} ${ccy} ${amt}`);

      try{ cashV2SetLastRec(saved); }catch(_){ }
      try{ cashV2RenderMovementsUI(saved); }catch(_){ }
      try{ cashV2UpdateCloseSummary(saved); }catch(_){ }
      try{ cashV2UpdateCloseEligibility(saved); }catch(_){ }

      resetForm();
      try{ if (inpAmt) inpAmt.focus(); }catch(_){ }
    }catch(err){
      console.error('[A33][CASHv2] movement add error', err);
      const msg = (err && (err.message || err.name)) ? (err.message || err.name) : String(err);
      showErr(msg);
    }
  }

  if (btnAdd){
    btnAdd.addEventListener('click', (e)=>{ try{ if (e) e.preventDefault(); }catch(_){ } addMovement(); });
  }
  if (inpAmt){
    inpAmt.addEventListener('keydown', (e)=>{ if (e && e.key === 'Enter'){ try{ e.preventDefault(); }catch(_){ } addMovement(); } });
  }
  if (inpDesc){
    inpDesc.addEventListener('keydown', (e)=>{ if (e && e.key === 'Enter'){ try{ e.preventDefault(); }catch(_){ } addMovement(); } });
  }

  resetForm();
  card.dataset.readyMove = '1';
}



// --- POS: Efectivo v2 — Cierre (Final + Esperado + Diferencia) — Etapa 5
function cashV2CoerceFinal(final){
  // Misma forma que Inicio: denomCounts + total por moneda
  return cashV2CoerceInitial(final);
}

function cashV2InitFinalUIOnce(){
  const card = document.getElementById('cashv2-final-card');
  if (!card) return;
  if (card.dataset.ready === '1') return;

  function build(ccy, tableId){
    const denoms = CASHV2_DENOMS[ccy] || [];
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    tbody.innerHTML = denoms.map(d=>{
      const k = String(d);
      const sym = (ccy === 'NIO') ? 'C$' : '$';
      return `\n<tr>\n  <td class=\"denom\"><b>${sym} ${k}</b></td>\n  <td>\n    <input type=\"number\" min=\"0\" step=\"1\" inputmode=\"numeric\" pattern=\"[0-9]*\"\n      class=\"cashv2-denom-input\"\n      data-cashv2-final=\"1\" data-ccy=\"${ccy}\" data-denom=\"${k}\"\n      id=\"cashv2-final-${ccy}-${k}\" placeholder=\"\" value=\"\"\n    >\n  </td>\n  <td class=\"sub\"><span id=\"cashv2-final-sub-${ccy}-${k}\">0</span></td>\n</tr>`;
    }).join('');
  }

  build('NIO', 'cashv2-table-final-nio');
  build('USD', 'cashv2-table-final-usd');

  // Totales en vivo (sin logs por input)
  card.addEventListener('input', (e)=>{
    const t = e && e.target;
    if (!t || t.getAttribute('data-cashv2-final') !== '1') return;
    cashV2UpdateFinalTotals();
  });

  // Normalizar al salir del input
  card.addEventListener('focusout', (e)=>{
    const t = e && e.target;
    if (!t || t.getAttribute('data-cashv2-final') !== '1') return;
    const raw = (t.value != null) ? String(t.value) : '';
    if (raw.trim() === ''){
      try{ t.value = ''; }catch(_){ }
      cashV2UpdateFinalTotals();
      return;
    }
    const n = cashV2NormCount(raw);
    t.value = String(n);
    cashV2UpdateFinalTotals();
  });

  const btn = document.getElementById('cashv2-btn-save-final');
  if (btn){
    btn.addEventListener('click', async ()=>{
      const eid = String(card.dataset.eventId || '').trim();
      const dk = String(card.dataset.dayKey || '').trim();
      if (!eid || !dk) return;

      const final = cashV2ReadFinalFromDom(true);
      try{
        const rec = await cashV2Ensure(eid, dk);
        rec.final = final;
        await cashV2RefreshPhysicalSalesOnRecordPOS(rec, eid, dk);
        const saved = await cashV2Save(rec);

        const nums = cashV2ComputeCloseNumbers(saved, { preferDom: false, finalOverride: final });
        const fn = nums.NIO || { final:0, expected:0, diff:0 };
        const fu = nums.USD || { final:0, expected:0, diff:0 };
        if (typeof window !== 'undefined' && window.A33_DEBUG_CASHV2) console.info(`[A33][CASHv2] final save ${eid} ${dk} totals NIO=${fn.final} USD=${fu.final} expected NIO=${fn.expected} USD=${fu.expected} diff NIO=${fn.diff} USD=${fu.diff}`);

        cashV2SetLastRec(saved);
        cashV2ApplyFinalToDom(saved.final);
        try{ cashV2UpdateCloseSummary(saved); }catch(_){ }
        try{ cashV2UpdateCloseEligibility(saved); }catch(_){ }
        const st = document.getElementById('cashv2-final-save-status');
        if (st){
          st.textContent = 'Guardado';
          setTimeout(()=>{ try{ st.textContent = ''; }catch(_){ } }, 2200);
        }
      }catch(err){
        console.error('[A33][CASHv2] final save error', err);
        const st = document.getElementById('cashv2-final-save-status');
        if (st){ st.textContent = 'Error'; setTimeout(()=>{ try{ st.textContent = ''; }catch(_){ } }, 2600); }
      }
    });
  }

  card.dataset.ready = '1';
  cashV2UpdateFinalTotals();
}

function cashV2ReadFinalFromDom(updateUi){
  const card = document.getElementById('cashv2-final-card');
  const final = cashV2DefaultInitial();
  if (!card) return final;

  const inputs = card.querySelectorAll('input[data-cashv2-final="1"]');
  inputs.forEach(inp=>{
    const ccy = String(inp.dataset.ccy || '').trim();
    const denom = String(inp.dataset.denom || '').trim();
    if (!ccy || !denom || !final[ccy]) return;
    final[ccy].denomCounts[denom] = cashV2CountToStore(inp.value);
  });

  for (const ccy of ['NIO','USD']){
    let total = 0;
    for (const d of (CASHV2_DENOMS[ccy] || [])){
      const k = String(d);
      const cnt = cashV2NormCount(final[ccy].denomCounts[k]);
      const sub = Number(d) * cnt;
      total += sub;
      if (updateUi){
        const elSub = document.getElementById(`cashv2-final-sub-${ccy}-${k}`);
        if (elSub) elSub.textContent = cashV2FmtInt(sub);
      }
    }
    final[ccy].total = cashV2Round2Money(total);
    if (updateUi){
      const elTot = document.getElementById(ccy === 'NIO' ? 'cashv2-final-total-nio' : 'cashv2-final-total-usd');
      if (elTot) elTot.textContent = cashV2FmtInt(total);
    }
  }

  return final;
}

function cashV2UpdateFinalTotals(){
  cashV2ReadFinalFromDom(true);
  try{ cashV2UpdateCloseSummary(); }catch(_){ }
}

function cashV2ApplyFinalToDom(final){
  const card = document.getElementById('cashv2-final-card');
  if (!card) return;
  const v = cashV2CoerceFinal(final);
  for (const ccy of ['NIO','USD']){
    for (const d of (CASHV2_DENOMS[ccy] || [])){
      const k = String(d);
      const inp = document.getElementById(`cashv2-final-${ccy}-${k}`);
      if (inp) inp.value = cashV2CountDomValue(v[ccy].denomCounts[k]);
    }
  }
  cashV2UpdateFinalTotals();
}

function cashV2SetFinalEnabled(enabled){
  const card = document.getElementById('cashv2-final-card');
  if (!card) return;
  const en = !!enabled;
  card.querySelectorAll('input[data-cashv2-final="1"]').forEach(inp=>{ inp.disabled = !en; });
  const btn = document.getElementById('cashv2-btn-save-final');
  if (btn) btn.disabled = !en;
}

function cashV2SumMovementsByCurrency(movements, currency){
  const ccy = String(currency || '').trim().toUpperCase();
  const arr = Array.isArray(movements) ? movements : [];
  let inc = 0;
  let out = 0;
  let adj = 0;

  for (const m of arr){
    if (!m || typeof m !== 'object') continue;
    if (String(m.currency || '').trim().toUpperCase() != ccy) continue;
    const k = String(m.kind || '').trim().toUpperCase();
    const allowNeg = (k === 'ADJUST');
    let amt = cashV2NormAmountInt(m.amount, { allowNegative: allowNeg });
    if (!Number.isFinite(amt)) amt = 0;

    if (k === 'IN' || k === 'ADJUST_IN') inc += Math.abs(amt);
    else if (k === 'OUT' || k === 'ADJUST_OUT') out += Math.abs(amt);
    else if (k === 'ADJUST') adj += amt;
  }

  return { in: inc, out, adjust: adj };
}

function cashV2ComputeCloseNumbers(rec, opts){
  const o = {
    NIO: { initial:0, net:0, in:0, out:0, sales:0, adjust:0, expected:0, final:0, diff:0 },
    USD: { initial:0, net:0, in:0, out:0, sales:0, adjust:0, expected:0, final:0, diff:0 }
  };

  const preferDom = !(opts && opts.preferDom === false);
  const initialOverride = opts && opts.initialOverride ? opts.initialOverride : null;
  const finalOverride = opts && opts.finalOverride ? opts.finalOverride : null;

  // Inicial: DOM (si está) o record
  let initObj = null;
  try{
    const ic = document.getElementById('cashv2-initial-card');
    if (preferDom && ic) initObj = cashV2ReadInitialFromDom(false);
  }catch(_){ initObj = null; }
  if (!initObj) initObj = initialOverride ? cashV2CoerceInitial(initialOverride) : cashV2CoerceInitial(rec && rec.initial);

  // Final: DOM (si está) o record
  let finObj = null;
  try{
    const fc = document.getElementById('cashv2-final-card');
    if (preferDom && fc) finObj = cashV2ReadFinalFromDom(false);
  }catch(_){ finObj = null; }
  if (!finObj) finObj = finalOverride ? cashV2CoerceFinal(finalOverride) : cashV2CoerceFinal(rec && rec.final);

  const movs = cashV2CoerceMovements(rec && rec.movements);

  const iN = (initObj && initObj.NIO && Number(initObj.NIO.total)) || 0;
  const iU = (initObj && initObj.USD && Number(initObj.USD.total)) || 0;
  const fN = (finObj && finObj.NIO && Number(finObj.NIO.total)) || 0;
  const fU = (finObj && finObj.USD && Number(finObj.USD.total)) || 0;

  const sN = cashV2SumMovementsByCurrency(movs, 'NIO');
  const sU = cashV2SumMovementsByCurrency(movs, 'USD');

  const salesC = cashV2Round2Money((rec && rec.cashSalesC != null) ? rec.cashSalesC : cashV2GetCashSalesC());
  const salesUSD = cashV2Round2Money((rec && rec.cashSalesUSD != null) ? rec.cashSalesUSD : cashV2GetCashSalesUSD());

  const netNio = cashV2Round2Money((sN.in - sN.out) + sN.adjust);
  const netUsd = cashV2Round2Money((sU.in - sU.out) + sU.adjust);

  const eN = cashV2Round2Money(iN + sN.in - sN.out + salesC + sN.adjust);
  const eU = cashV2Round2Money(iU + sU.in - sU.out + salesUSD + sU.adjust);

  o.NIO.initial = cashV2Round2Money(iN);
  o.NIO.in = cashV2Round2Money(sN.in);
  o.NIO.out = cashV2Round2Money(sN.out);
  o.NIO.sales = salesC;
  o.NIO.adjust = cashV2Round2Money(sN.adjust);
  o.NIO.net = netNio;
  o.NIO.expected = eN;
  o.NIO.final = cashV2Round2Money(fN);
  o.NIO.diff = cashV2Round2Money(fN - eN);

  o.USD.initial = cashV2Round2Money(iU);
  o.USD.in = cashV2Round2Money(sU.in);
  o.USD.out = cashV2Round2Money(sU.out);
  o.USD.sales = salesUSD;
  o.USD.adjust = cashV2Round2Money(sU.adjust);
  o.USD.net = netUsd;
  o.USD.expected = eU;
  o.USD.final = cashV2Round2Money(fU);
  o.USD.diff = cashV2Round2Money(fU - eU);

  return o;
}

function cashV2SetDiffPill(el, diff){
  if (!el) return;
  const n = cashV2Round2Money(diff);
  el.textContent = cashV2FmtMoney(n);
  el.classList.toggle('danger', n !== 0);
}

function cashV2ClearCloseSummary(){
  const ids = [
    'cashv2-sum-initial-nio','cashv2-sum-in-nio','cashv2-sum-out-nio','cashv2-sum-sales-nio','cashv2-sum-adjust-nio','cashv2-sum-expected-nio','cashv2-sum-final-nio',
    'cashv2-sum-initial-usd','cashv2-sum-in-usd','cashv2-sum-out-usd','cashv2-sum-sales-usd','cashv2-sum-adjust-usd','cashv2-sum-expected-usd','cashv2-sum-final-usd'
  ];
  ids.forEach(id=>{ try{ const el = document.getElementById(id); if (el) el.textContent = '0.00'; }catch(_){ } });
  try{ cashV2SetDiffPill(document.getElementById('cashv2-sum-diff-nio'), 0); }catch(_){ }
  try{ cashV2SetDiffPill(document.getElementById('cashv2-sum-diff-usd'), 0); }catch(_){ }
}

function cashV2UpdateCloseSummary(rec){
  const r = (rec != null) ? rec : cashV2GetLastRec();
  if (!r){ cashV2ClearCloseSummary(); return; }

  const nums = cashV2ComputeCloseNumbers(r, { preferDom: true });
  try{ const el = document.getElementById('cashv2-sum-initial-nio'); if (el) el.textContent = cashV2FmtMoney(nums.NIO.initial); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-in-nio'); if (el) el.textContent = cashV2FmtMoney(nums.NIO.in); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-out-nio'); if (el) el.textContent = cashV2FmtMoney(nums.NIO.out); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-sales-nio'); if (el) el.textContent = cashV2FmtMoney(nums.NIO.sales); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-adjust-nio'); if (el) el.textContent = cashV2FmtMoney(nums.NIO.adjust); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-expected-nio'); if (el) el.textContent = cashV2FmtMoney(nums.NIO.expected); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-final-nio'); if (el) el.textContent = cashV2FmtMoney(nums.NIO.final); }catch(_){ }
  try{ cashV2SetDiffPill(document.getElementById('cashv2-sum-diff-nio'), nums.NIO.diff); }catch(_){ }

  try{ const el = document.getElementById('cashv2-sum-initial-usd'); if (el) el.textContent = cashV2FmtMoney(nums.USD.initial); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-in-usd'); if (el) el.textContent = cashV2FmtMoney(nums.USD.in); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-out-usd'); if (el) el.textContent = cashV2FmtMoney(nums.USD.out); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-sales-usd'); if (el) el.textContent = cashV2FmtMoney(nums.USD.sales); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-adjust-usd'); if (el) el.textContent = cashV2FmtMoney(nums.USD.adjust); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-expected-usd'); if (el) el.textContent = cashV2FmtMoney(nums.USD.expected); }catch(_){ }
  try{ const el = document.getElementById('cashv2-sum-final-usd'); if (el) el.textContent = cashV2FmtMoney(nums.USD.final); }catch(_){ }
  try{ cashV2SetDiffPill(document.getElementById('cashv2-sum-diff-usd'), nums.USD.diff); }catch(_){ }
}

// --- POS: Efectivo v2 — CIERRE PROHIBIDO con diferencia (hard rule) — Etapa 6
function cashV2IsClosed(rec){
  const s = String((rec && rec.status) || '').trim().toUpperCase();
  return s === 'CLOSED';
}



// --- POS: Efectivo v2 — Respeto de BLOQUEOS (dayLocks / cierres) — Etapa 7 (READ-ONLY)
const __CASHV2_LOCK_LOG_ONCE = new Set();

async function isDayLocked(eventId, dayKey){
  const eid = Number(eventId);
  const dk = safeYMD(dayKey);

  // Asegurar DB para lecturas (sin writes)
  try{ if (!db) await openDB(); }catch(_){ }

  // Fast path: estado ya calculado por el POS (venta)
  try{
    const st = (typeof window !== 'undefined' && window.__A33_SELL_STATE) ? window.__A33_SELL_STATE : (typeof __A33_SELL_STATE !== 'undefined' ? __A33_SELL_STATE : null);
    if (st && Number(st.eventId) === eid && String(st.dayKey || '') === dk && !!st.dayClosed) return true;
  }catch(_){ }

  // Evento cerrado (candado global de evento)
  try{
    const evs = await getAll('events');
    const ev = (Array.isArray(evs) ? evs : []).find(e => e && Number(e.id) === eid);
    if (ev && ev.closedAt) return true;
  }catch(_){ }

  // Candado por día/evento (dayLocks)
  try{
    const lock = await getDayLockRecordPOS(eid, dk);
    if (lock && lock.isClosed) return true;
  }catch(_){ }

  return false;
}

function cashV2SetMovementsEnabled(enabled){
  const en = !!enabled;
  const btnAdd = document.getElementById('cashv2-btn-add-movement');
  if (btnAdd) btnAdd.disabled = !en;

  // Etapa 2/7: bloque visible (inline)
  ['cashv2-move-kind-inline','cashv2-move-currency-inline','cashv2-move-amount-inline','cashv2-move-desc-inline'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.disabled = !en;
  });

  // Compat: modal (si existe en DOM)
  const btnSave = document.getElementById('cashv2-move-save');
  if (btnSave) btnSave.disabled = !en;
}

function cashV2SetCloseUiState(state){
  const btn = document.getElementById('cashv2-btn-close');
  if (!btn) return;
  const blocker = document.getElementById('cashv2-close-blocker');
  const closed = document.getElementById('cashv2-close-closed');
  const closedAt = document.getElementById('cashv2-closed-at');
  const btnReopen = document.getElementById('cashv2-btn-admin-reopen');

  const hide = (el)=>{ try{ if (el) el.style.display = 'none'; }catch(_){ } };
  const show = (el)=>{ try{ if (el) el.style.display = 'block'; }catch(_){ } };

  if (state && state.closed){
    btn.disabled = true;
    btn.textContent = 'Cerrado';
    hide(blocker);
    show(closed);
    try{ if (btnReopen){ btnReopen.style.display = 'inline-flex'; btnReopen.disabled = false; } }catch(_){ }
    try{
      if (closedAt){
        const ts = (state && state.closedAt) ? Number(state.closedAt) : 0;
        closedAt.textContent = ts ? ('· ' + new Date(ts).toLocaleString('es-NI')) : '';
      }
    }catch(_){ if (closedAt) closedAt.textContent = ''; }
    return;
  }

  try{ if (btnReopen){ btnReopen.style.display = 'none'; btnReopen.disabled = true; } }catch(_){ }

  btn.textContent = 'Cerrar día';
  btn.disabled = !(state && state.canClose);

  hide(closed);
  try{ if (closedAt) closedAt.textContent = ''; }catch(_){ }

  if (blocker){
    const reason = state && state.reason ? String(state.reason) : '';
    if (reason){
      const sm = blocker.querySelector('small');
      if (sm) sm.textContent = reason;
      else blocker.textContent = reason;
      show(blocker);
    }else{
      hide(blocker);
    }
  }
}

function cashV2EvalCloseRule(rec){
  const r = rec || null;
  if (!r || typeof r !== 'object') return { canClose:false, reason:'' };
  if (cashV2IsClosed(r)){
    return { closed:true, canClose:false, closedAt: (r.closeTs || (r.meta && r.meta.closedAt)) || null };
  }

  if (!r.initial) return { canClose:false, reason:'No se puede cerrar: falta Inicio guardado' };
  if (!r.final) return { canClose:false, reason:'No se puede cerrar: falta Final guardado' };

  // Hard rule: diff debe ser 0 en ambas monedas (usar record persistido)
  const numsRec = cashV2ComputeCloseNumbers(r, { preferDom: false });
  const dn = cashV2Round2Money(Number(numsRec && numsRec.NIO && numsRec.NIO.diff) || 0);
  const du = cashV2Round2Money(Number(numsRec && numsRec.USD && numsRec.USD.diff) || 0);

  // Si el usuario cambió inputs pero no guardó, bloquea cierre para evitar inconsistencias
  let domChanged = false;
  try{
    const numsDom = cashV2ComputeCloseNumbers(r, { preferDom: true });
    domChanged = (Number(numsDom.NIO.initial)||0)!==(Number(numsRec.NIO.initial)||0)       || (Number(numsDom.USD.initial)||0)!==(Number(numsRec.USD.initial)||0)       || (Number(numsDom.NIO.final)||0)!==(Number(numsRec.NIO.final)||0)       || (Number(numsDom.USD.final)||0)!==(Number(numsRec.USD.final)||0);
  }catch(_){ domChanged = false; }

  if (domChanged){
    return { canClose:false, reason:'No se puede cerrar: guarda Inicio y/o Final' };
  }
  if (dn !== 0 || du !== 0){
    const parts = [];
    if (dn !== 0) parts.push(`Diferencia C$ = ${cashV2FmtMoney(dn)}`);
    if (du !== 0) parts.push(`Diferencia USD = ${cashV2FmtMoney(du)}`);
    return { canClose:false, reason:'No se puede cerrar: ' + parts.join(' | ') };
  }
  return { canClose:true };
}

function cashV2ApplyReadOnlyUi(isClosed){
  const ro = !!isClosed;
  try{ cashV2SetFxEnabled(!ro); }catch(_){ }
  try{ cashV2SetInitialEnabled(!ro); }catch(_){ }
  try{ cashV2SetFinalEnabled(!ro); }catch(_){ }
  try{ cashV2SetMovementsEnabled(!ro); }catch(_){ }
}

function cashV2UpdateCloseEligibility(rec){
  const r = (rec != null) ? rec : cashV2GetLastRec();
  let st = cashV2EvalCloseRule(r);

  // Regla dura: si evento/día está BLOQUEADO, nunca permitir cierre.
  try{
    const fcard = document.getElementById('cashv2-final-card');
    const blocked = !!(fcard && fcard.dataset && fcard.dataset.blocked === '1');
    const locked = !!(fcard && fcard.dataset && fcard.dataset.locked === '1');
    if (st && !st.closed){
      if (blocked) st = { canClose:false, reason:'Bloqueado: Efectivo OFF o evento inactivo' };
      else if (locked) st = { canClose:false, reason:'Día bloqueado (cierre del sistema)' };
    }
  }catch(_){ }

  cashV2SetCloseUiState(st);
}

function cashV2InitCloseUIOnce(){
  const btn = document.getElementById('cashv2-btn-close');
  if (!btn) return;
  if (btn.dataset.ready === '1') return;

  btn.addEventListener('click', async ()=>{
    const card = document.getElementById('cashv2-final-card');
    const eid = card ? String(card.dataset.eventId || '').trim() : '';
    const dk = card ? String(card.dataset.dayKey || '').trim() : '';
    if (!eid || !dk) return;

    // Guard extra: si está BLOQUEADO (evento inactivo/flag OFF) o LOCK del sistema, no cerrar.
    try{
      const blocked = !!(card && card.dataset && card.dataset.blocked === '1');
      const locked = !!(card && card.dataset && card.dataset.locked === '1');
      if (blocked || locked){
        try{ cashV2UpdateCloseEligibility(cashV2GetLastRec()); }catch(_){ }
        try{ toast(blocked ? 'Evento bloqueado: no permite cerrar' : 'Día bloqueado: no permite cerrar'); }catch(_){ }
        return;
      }
    }catch(_){ }

    try{
      const rec = await cashV2Ensure(eid, dk);
      await cashV2RefreshPhysicalSalesOnRecordPOS(rec, eid, dk);
      // Re-evaluación dura (record)
      const st = cashV2EvalCloseRule(rec);
      if (st.closed){
        cashV2SetLastRec(rec);
        cashV2ApplyReadOnlyUi(true);
        cashV2UpdateCloseEligibility(rec);
        try{ toast('Ya está cerrado'); }catch(_){ }
        return;
      }
      if (!st.canClose){
        cashV2SetLastRec(rec);
        cashV2UpdateCloseEligibility(rec);
        try{ if (st.reason) toast(st.reason); }catch(_){ }
        return;
      }

      rec.status = 'CLOSED';
      rec.closeTs = Date.now();
      rec.meta = (rec.meta && typeof rec.meta === 'object') ? rec.meta : {};
      rec.meta.closedAt = Number(rec.closeTs) || Date.now();

      const saved = await cashV2Save(rec);
      cashV2SetLastRec(saved);

      // Etapa 2/5: Snapshot versionado al cerrar (v1, v2, ... por eventId+dayKey)
      try{ await createHistorySnapshotFromV2(saved); }catch(_){ }

      // UI: bloquear + refrescar indicadores
      cashV2ApplyReadOnlyUi(true);
      cashV2UpdateCloseEligibility(saved);
      try{ cashV2UpdateCloseSummary(saved); }catch(_){ }

      try{
        const statusTag = document.getElementById('cashv2-status-tag');
        const ui = cashV2StatusToUiPOS(saved && saved.status);
        if (statusTag){
          statusTag.textContent = ui.text;
          statusTag.classList.toggle('open', ui.cls === 'open');
          statusTag.classList.toggle('closed', ui.cls !== 'open');
        }
      }catch(_){ }

      try{ toast('Cierre confirmado'); }catch(_){ }
    }catch(err){
      console.error('[A33][CASHv2] close error', err);
      try{ toast('Error al cerrar'); }catch(_){ }
    }
  });

  btn.dataset.ready = '1';
}


// --- POS: Efectivo v2 — Reapertura ADMIN con auditoría — Etapa 5/5
function cashV2SetAdminReopenError(msg){
  const el = document.getElementById('cashv2-admin-reopen-error');
  if (!el) return;
  try{ el.style.whiteSpace = 'pre-line'; }catch(_){ }
  if (!msg){
    try{ el.style.display = 'none'; el.textContent = ''; }catch(_){ }
    return;
  }
  try{ el.style.display = 'block'; el.textContent = String(msg); }catch(_){ }
}

async function cashV2AdminReopenAtomic(eventId, dayKey, reason){
  const eid = cashV2AssertEventId(eventId);
  const dk = cashV2AssertDayKeyCanon(dayKey);
  const why = String(reason || '').trim();
  if (!why) throw new Error('Motivo obligatorio');
  try{ if (!db) await openDB(); }catch(_){ }
  const key = cashV2Key(eid, dk);
  const nowTs = Date.now();
  const nowIso = new Date(nowTs).toISOString();

  return await new Promise((resolve, reject)=>{
    let done = false;
    const fail = (err)=>{
      if (done) return;
      done = true;
      try{ reject(err || new Error('No se pudo reabrir')); }catch(_){ }
    };
    let tx = null;
    try{
      tx = db.transaction([CASH_V2_STORE], 'readwrite');
    }catch(err){
      return fail(err);
    }
    const st = tx.objectStore(CASH_V2_STORE);
    const rq = st.get(key);

    rq.onerror = ()=>{
      try{ tx.abort(); }catch(_){ }
      fail(rq.error || new Error('No se pudo leer el registro'));
    };

    rq.onsuccess = ()=>{
      const rec = rq.result;
      if (!rec){
        try{ tx.abort(); }catch(_){ }
        return fail(new Error('Registro no encontrado'));
      }
      const s = cashV2NormStatus(rec.status);
      if (s !== 'CLOSED'){
        try{ tx.abort(); }catch(_){ }
        return fail(new Error('Solo se puede reabrir si está CERRADO'));
      }

      const auditItem = { ts: nowTs, action: 'ADMIN_REOPEN', reason: why, dayKey: dk, eventId: eid };
      const audit = Array.isArray(rec.audit) ? rec.audit.slice() : [];
      audit.push(auditItem);
      rec.audit = audit;

      // Reabrir sin borrar data previa (initial/final/movements)
      rec.status = 'OPEN';
      try{
        const m = (rec.meta && typeof rec.meta === 'object') ? rec.meta : {};
        m.updatedAt = nowIso;
        rec.meta = m;
      }catch(_){ }

      const putRq = st.put(rec);
      putRq.onerror = ()=>{
        try{ tx.abort(); }catch(_){ }
        fail(putRq.error || new Error('No se pudo guardar el registro'));
      };
      putRq.onsuccess = ()=>{ };
    };

    tx.oncomplete = ()=>{
      if (done) return;
      done = true;
      resolve(true);
    };
    tx.onerror = ()=>{
      fail(tx.error || new Error('Error de transacción'));
    };
    tx.onabort = ()=>{
      fail(tx.error || new Error('Transacción abortada'));
    };
  });
}

function cashV2InitAdminReopenUIOnce(){
  const btn = document.getElementById('cashv2-btn-admin-reopen');
  const modal = document.getElementById('cashv2-admin-reopen-modal');
  if (!btn || !modal) return;
  if (btn.dataset.ready === '1') return;

  const btnCancel = document.getElementById('cashv2-admin-reopen-cancel');
  const btnCancel2 = document.getElementById('cashv2-admin-reopen-cancel2');
  const btnConfirm = document.getElementById('cashv2-admin-reopen-confirm');
  const inReason = document.getElementById('cashv2-admin-reopen-reason');
  const inPhrase = document.getElementById('cashv2-admin-reopen-phrase');
  const lblEv = document.getElementById('cashv2-admin-reopen-ev');
  const lblDay = document.getElementById('cashv2-admin-reopen-day');

  const close = ()=>{
    try{ closeModalPOS('cashv2-admin-reopen-modal'); }catch(_){ try{ modal.style.display = 'none'; }catch(__){} }
  };

  const reset = ()=>{
    try{ cashV2SetAdminReopenError(''); }catch(_){ }
    try{ if (inReason) inReason.value = ''; }catch(_){ }
    try{ if (inPhrase) inPhrase.value = ''; }catch(_){ }
    try{ if (btnConfirm) btnConfirm.disabled = false; }catch(_){ }
  };

  if (btnCancel){ btnCancel.addEventListener('click', (e)=>{ e.preventDefault(); close(); }); }
  if (btnCancel2){ btnCancel2.addEventListener('click', (e)=>{ e.preventDefault(); close(); }); }

  btn.addEventListener('click', (e)=>{
    e.preventDefault();
    try{
      const fcard = document.getElementById('cashv2-final-card');
      const eid = fcard ? String(fcard.dataset.eventId || '').trim() : '';
      const dk = fcard ? String(fcard.dataset.dayKey || '').trim() : '';
      if (!eid || !dk) return;
      try{ const last = cashV2GetLastRec(); if (!cashV2IsClosed(last)) return; }catch(_){ return; }
      modal.dataset.eventId = eid;
      modal.dataset.dayKey = dk;
      if (lblEv) lblEv.textContent = eid;
      if (lblDay) lblDay.textContent = dk;
      reset();
      try{ openModalPOS('cashv2-admin-reopen-modal'); }catch(_){ try{ modal.style.display = 'flex'; }catch(__){} }
      try{ if (inReason) inReason.focus(); }catch(_){ }
    }catch(_){ }
  });

  if (btnConfirm){
    btnConfirm.addEventListener('click', async (e)=>{
      e.preventDefault();
      try{ cashV2SetAdminReopenError(''); }catch(_){ }

      const eid = String(modal.dataset.eventId || '').trim();
      const dk = String(modal.dataset.dayKey || '').trim();
      const reason = String(inReason ? inReason.value : '').trim();
      const phrase = String(inPhrase ? inPhrase.value : '').trim();

      if (!eid || !dk){
        cashV2SetAdminReopenError('Contexto inválido (evento/día).');
        return;
      }
      if (!reason){
        cashV2SetAdminReopenError('Motivo obligatorio.');
        return;
      }
      if (phrase.toUpperCase() != 'REABRIR'){
        cashV2SetAdminReopenError('Confirmación inválida. Escribe REABRIR.');
        return;
      }

      try{ btnConfirm.disabled = true; }catch(_){ }
      try{
        await cashV2AdminReopenAtomic(eid, dk, reason);
        // Etapa 2/5: reflejar reapertura en Histórico como OPEN (sin snapshot)
        try{ const rr = await cashV2Load(eid, dk); if (rr) await cashV2HistUpsertHeaderFromV2(rr); }catch(_){ }
        close();
        try{ toast('Día reabierto (admin)'); }catch(_){ }
        try{ await renderEfectivoTab(); }catch(_){ }
      }catch(err){
        console.error('[A33][CASHv2] admin reopen error', err);
        const msg = (err && (err.message || err.name)) ? (err.message || err.name) : String(err);
        cashV2SetAdminReopenError(msg);
        try{ btnConfirm.disabled = false; }catch(_){ }
      }
    });
  }

  btn.dataset.ready = '1';
}



// --- POS: Efectivo v2 — Selector de evento (TODOS) + “Efectivo activo” por evento + Modo BLOQUEADO — Etapa 1/7
const CASHV2_FLAGS_LS_KEY = 'A33.EF2.eventFlags';
const CASHV2_VIEW_EVENT_LS_KEY = 'A33.EF2.viewEventId';
let __CASHV2_VIEW_EVENT_ID = null;

function cashV2GetViewEventId(){
  try{ if (__CASHV2_VIEW_EVENT_ID != null && String(__CASHV2_VIEW_EVENT_ID).trim() !== '') return String(__CASHV2_VIEW_EVENT_ID); }catch(_){ }
  try{
    const v = localStorage.getItem(CASHV2_VIEW_EVENT_LS_KEY);
    if (v != null && String(v).trim() !== ''){
      __CASHV2_VIEW_EVENT_ID = String(v).trim();
      return String(__CASHV2_VIEW_EVENT_ID);
    }
  }catch(_){ }
  return '';
}

function cashV2SetViewEventId(v){
  const s = (v == null) ? '' : String(v).trim();
  __CASHV2_VIEW_EVENT_ID = s || null;
  try{
    if (s) localStorage.setItem(CASHV2_VIEW_EVENT_LS_KEY, s);
    else localStorage.removeItem(CASHV2_VIEW_EVENT_LS_KEY);
  }catch(_){ }
}

function cashV2LoadFlagsLS(){
  try{
    const raw = localStorage.getItem(CASHV2_FLAGS_LS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  }catch(_){ }
  return {};
}

function cashV2SaveFlagsLS(obj){
  try{
    if (!obj || typeof obj !== 'object') return;
    localStorage.setItem(CASHV2_FLAGS_LS_KEY, JSON.stringify(obj));
  }catch(_){ }
}

function cashV2GetFlagForEventObj(ev){
  // Default conservador (retro-compat): si no hay bandera, asumimos ON.
  try{
    if (ev && typeof ev.cashV2Active === 'boolean') return ev.cashV2Active;
  }catch(_){ }
  try{
    const m = cashV2LoadFlagsLS();
    const k = ev && (ev.id != null) ? String(ev.id) : '';
    if (k && Object.prototype.hasOwnProperty.call(m, k)) return !!m[k];
  }catch(_){ }
  return true;
}

async function cashV2PersistEventFlag(eventId, enabled){
  const eidNum = Number(eventId);
  const en = !!enabled;
  let saved = false;

  // Preferir donde ya persisten eventos (IndexedDB store 'events')
  try{
    if (!db) await openDB();
    if (Number.isFinite(eidNum)){
      const ev = await getOne('events', eidNum);
      if (ev && typeof ev === 'object'){
        ev.cashV2Active = en;
        await put('events', ev);
        saved = true;
      }
    }
  }catch(_){ saved = false; }

  // Fallback mínimo canónico (sin compatibilidad anterior)
  if (!saved){
    try{
      const m = cashV2LoadFlagsLS();
      if (Number.isFinite(eidNum)) m[String(eidNum)] = en;
      cashV2SaveFlagsLS(m);
      saved = true;
    }catch(_){ saved = false; }
  }

  return saved;
}

function cashV2RenderEventBadgesUI(state){
  const host = document.getElementById('cashv2-event-badges');
  if (!host) return;
  const s = state && typeof state === 'object' ? state : {};
  const parts = [];
  if (s.isActive) parts.push('<span class="tag small open">Activo</span>');
  if (s.isInactive) parts.push('<span class="tag small closed">Inactivo (solo lectura)</span>');
  if (s.isOff) parts.push('<span class="tag small" style="border-color:#b16; color:#b16;">Efectivo OFF</span>');
  host.innerHTML = parts.join('');
}

function cashV2InitEventSelectorUIOnce(){
  const sel = document.getElementById('cashv2-event-select');
  const tog = document.getElementById('cashv2-event-enabled');
  if (!sel || !tog) return;
  if (sel.dataset.ready === '1') return;

  sel.addEventListener('change', ()=>{
    try{ cashV2SetViewEventId(sel.value || ''); }catch(_){ }
    renderEfectivoTab().catch(err=>console.error(err));
  });

  tog.addEventListener('change', async ()=>{
    const eid = String(sel.value || '').trim();
    if (!eid) return;
    let activeId = null;
    try{ activeId = await getMeta('currentEventId'); }catch(_){ activeId = null; }
    if (activeId == null || String(activeId).trim() !== String(eid)){
      // Por regla: solo editable si el evento es ACTIVO
      try{ tog.checked = !!tog.checked; }catch(_){ }
      return;
    }
    try{ await cashV2PersistEventFlag(eid, tog.checked); }catch(_){ }
    renderEfectivoTab().catch(err=>console.error(err));
  });

  sel.dataset.ready = '1';
}


// --- POS: Efectivo v2 — Histórico: UI listado (solo lectura) — Etapa 3/5
function cashV2HistSafeTs(ts){
  const n = Number(ts);
  return (Number.isFinite(n) && n > 0) ? n : 0;
}

function cashV2HistEventLabel(evMap, eventId){
  const eid = String(eventId || '').trim();
  if (!eid) return 'Evento';
  try{
    const ev = (evMap && typeof evMap.get === 'function') ? evMap.get(eid) : null;
    const name = (ev && ev.name != null) ? String(ev.name).trim() : '';
    return name ? `${name} (#${eid})` : `Evento #${eid}`;
  }catch(_){
    return `Evento #${eid}`;
  }
}

// --- POS: Efectivo v2 — Histórico: Vista DETALLE por día + versión + auditoría — Etapa 4/5
let __CASHV2_HIST_EVMAP = new Map();
let __CASHV2_HIST_DETAIL_STATE = null;

function cashV2HistShowListView(){
  const listEl = document.getElementById('cashv2-hist-list');
  const detailEl = document.getElementById('cashv2-hist-detail');
  const noSnap = document.getElementById('cashv2-hist-detail-nosnap');
  const vBox = document.getElementById('cashv2-hist-version-box');
  const vBtns = document.getElementById('cashv2-hist-version-buttons');
  const vMeta = document.getElementById('cashv2-hist-version-meta');
  const body = document.getElementById('cashv2-hist-detail-body');
  try{ if (listEl) listEl.style.display = 'block'; }catch(_){ }
  try{ if (detailEl) detailEl.style.display = 'none'; }catch(_){ }
  try{ if (noSnap) noSnap.style.display = 'none'; }catch(_){ }
  try{ if (vBox) vBox.style.display = 'none'; }catch(_){ }
  try{ if (vBtns) vBtns.innerHTML = ''; }catch(_){ }
  try{ if (vMeta) vMeta.textContent = ''; }catch(_){ }
  try{ if (body) body.innerHTML = ''; }catch(_){ }
  try{ __CASHV2_HIST_DETAIL_STATE = null; }catch(_){ }
}

function cashV2HistShowDetailView(){
  const listEl = document.getElementById('cashv2-hist-list');
  const detailEl = document.getElementById('cashv2-hist-detail');
  try{ if (listEl) listEl.style.display = 'none'; }catch(_){ }
  try{ if (detailEl) detailEl.style.display = 'block'; }catch(_){ }
}

function cashV2HistSetStatusPill(el, status){
  if (!el) return;
  const ui = cashV2StatusToUiPOS(status);
  try{ el.textContent = (ui && ui.text) ? ui.text : '—'; }catch(_){ }
  try{ el.classList.remove('warn'); el.classList.remove('danger'); }catch(_){ }
  // OPEN => warn (visual), CLOSED => normal
  try{ if ((ui && ui.cls) === 'open') el.classList.add('warn'); }catch(_){ }
}

function cashV2HistKindLabel(kind){
  const k = String(kind || '').toUpperCase();
  if (k === 'OUT') return 'Salida';
  if (k === 'ADJUST') return 'Ajuste';
  return 'Entrada';
}

function cashV2HistCurrencySym(ccy){
  const c = String(ccy || '').toUpperCase();
  return (c === 'USD') ? 'USD$' : 'C$';
}

function cashV2HistSumMoves(moves, wantKind){
  const k = String(wantKind || '').toUpperCase();
  let sum = 0;
  for (const m of (Array.isArray(moves) ? moves : [])){
    try{
      const mk = String(m && m.kind || '').toUpperCase();
      if (mk !== k) continue;
      let a = Number(m && m.amount);
      if (!Number.isFinite(a)) a = 0;
      if (k === 'IN' || k === 'OUT') a = Math.abs(a);
      sum += a;
    }catch(_){ }
  }
  return cashV2Round2Money(sum);
}

function cashV2HistDenomTable(ccy, title, block){
  const b = (block && typeof block === 'object') ? block : { denomCounts:{}, total:0 };
  const dc = (b.denomCounts && typeof b.denomCounts === 'object') ? b.denomCounts : {};
  const denoms = (CASHV2_DENOMS && CASHV2_DENOMS[ccy]) ? CASHV2_DENOMS[ccy] : [];
  const rows = [];
  for (const d of (denoms || [])){
    const key = String(d);
    let cnt = Number(dc[key]);
    if (!Number.isFinite(cnt)) cnt = 0;
    cnt = Math.max(0, Math.trunc(cnt));
    const sub = cashV2Round2Money(Number(d) * cnt);
    const label = (ccy === 'USD') ? ('$' + String(d)) : ('C$ ' + String(d));
    rows.push(`<tr><td class="denom"><b>${escapeHtml(label)}</b></td><td>${escapeHtml(cashV2FmtInt(cnt))}</td><td class="sub">${escapeHtml(cashV2FmtMoney(sub))}</td></tr>`);
  }
  const total = cashV2Round2Money(b.total != null ? b.total : cashV2SumDenomTotal(ccy, dc));
  return `
    <div class="${title === 'Inicial' ? 'cashv2-initial' : 'cashv2-final'}">
      <div class="muted"><small><b>${escapeHtml(title)}</b></small></div>
      <table class="cashv2-summary-table" style="margin-top:6px">
        <tbody>
          ${rows.join('')}
          <tr><td colspan="2"><b>Total</b></td><td class="sub"><b>${escapeHtml(cashV2FmtMoney(total))}</b></td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function cashV2HistBuildSummaryTable(ccy, block){
  const b = (block && typeof block === 'object') ? block : {};
  const initial = cashV2Round2Money(b.initial && b.initial.total);
  const finalT = cashV2Round2Money(b.finalCount && b.finalCount.total);
  const moves = Array.isArray(b.movements) ? b.movements : [];
  const entradas = cashV2HistSumMoves(moves, 'IN');
  const salidas = cashV2HistSumMoves(moves, 'OUT');
  const ajuste = cashV2HistSumMoves(moves, 'ADJUST');
  const ventas = (ccy === 'NIO') ? cashV2Round2Money(b.cashSalesC$ || 0) : cashV2Round2Money(b.cashSalesUSD || 0);
  const esperado = cashV2Round2Money(b.expected || 0);
  const dif = cashV2Round2Money(b.diff || 0);
  const difCls = (dif !== 0) ? 'pill danger' : 'pill';

  const sym = cashV2HistCurrencySym(ccy);
  return `
    <table class="cashv2-summary-table">
      <tbody>
        <tr><td>Inicial</td><td class="sub">${escapeHtml(sym)} ${escapeHtml(cashV2FmtMoney(initial))}</td></tr>
        <tr><td>Entradas</td><td class="sub">${escapeHtml(sym)} ${escapeHtml(cashV2FmtMoney(entradas))}</td></tr>
        <tr><td>Salidas</td><td class="sub">${escapeHtml(sym)} ${escapeHtml(cashV2FmtMoney(salidas))}</td></tr>
        <tr><td>Ventas efectivo</td><td class="sub">${(ventas == null) ? '—' : (escapeHtml(sym) + ' ' + escapeHtml(cashV2FmtMoney(ventas)))}</td></tr>
        <tr><td>Ajuste</td><td class="sub">${escapeHtml(sym)} ${escapeHtml(cashV2FmtMoney(ajuste))}</td></tr>
        <tr><td><b>Esperado</b></td><td class="sub"><b>${escapeHtml(sym)} ${escapeHtml(cashV2FmtMoney(esperado))}</b></td></tr>
        <tr><td>Final</td><td class="sub">${escapeHtml(sym)} ${escapeHtml(cashV2FmtMoney(finalT))}</td></tr>
        <tr><td><b>Diferencia</b></td><td class="sub"><span class="${difCls}">${escapeHtml(cashV2FmtMoney(dif))}</span></td></tr>
      </tbody>
    </table>
  `;
}

function cashV2HistRenderAudit(audit){
  const arr = Array.isArray(audit) ? audit.slice() : [];
  arr.sort((a,b)=> (cashV2HistSafeTs(a && a.ts) - cashV2HistSafeTs(b && b.ts)) );
  if (!arr.length){
    return '<div class="muted"><small>Sin auditoría.</small></div>';
  }
  const rows = [];
  for (const it of arr){
    const ts = cashV2HistSafeTs(it && it.ts);
    const action = String(it && it.action || '').trim() || '—';
    const reason = String(it && it.reason || '').trim() || '';
    rows.push(`
      <div class="cashv2-hist-audit-row">
        <div class="cashv2-hist-audit-left">
          <div class="cashv2-hist-audit-action">${escapeHtml(action)}</div>
          <div class="cashv2-hist-audit-reason">${escapeHtml(reason || '—')}</div>
        </div>
        <div class="cashv2-hist-audit-ts">${escapeHtml(ts ? fmtDateTimePOS(ts) : '—')}</div>
      </div>
    `);
  }
  return `<div class="cashv2-hist-audit-list">${rows.join('')}</div>`;
}

function cashV2HistRenderMovements(nioMoves, usdMoves){
  const all = [];
  for (const m of (Array.isArray(nioMoves) ? nioMoves : [])) all.push({ ...m, currency: 'NIO' });
  for (const m of (Array.isArray(usdMoves) ? usdMoves : [])) all.push({ ...m, currency: 'USD' });
  all.sort((a,b)=> cashV2HistSafeTs(b && b.ts) - cashV2HistSafeTs(a && a.ts));
  if (!all.length){
    return '<div class="muted"><small>Sin movimientos.</small></div>';
  }
  const rows = [];
  for (const m of all){
    const ts = cashV2HistSafeTs(m && m.ts);
    const kind = String(m && m.kind || '').toUpperCase();
    const ccy = (String(m && m.currency || '').toUpperCase() === 'USD') ? 'USD' : 'NIO';
    let amt = Number(m && m.amount);
    if (!Number.isFinite(amt)) amt = 0;

    let sign = '';
    let shown = amt;
    if (kind === 'OUT'){ sign = '-'; shown = Math.abs(amt); }
    else if (kind === 'IN'){ sign = '+'; shown = Math.abs(amt); }
    else { sign = (amt >= 0) ? '+' : ''; shown = amt; }

    const sym = cashV2HistCurrencySym(ccy);
    const opClass = cashV2NormalizeOperationalClass(m.operationalClass || m.clasificacionOperativa || '', cashV2OperationalClassFromKind(kind));
    const topTag = `<span class="cashv2-mtag"><b>${escapeHtml(cashV2OperationalClassLabel(opClass) || cashV2HistKindLabel(kind))}</b><span>${escapeHtml(sym)}</span></span>`;
    const note = (m && m.note != null) ? String(m.note).trim() : ((m && m.desc != null) ? String(m.desc).trim() : '');

    rows.push(`
      <div class="cashv2-move-row">
        <div class="cashv2-move-left">
          <div class="cashv2-move-top">
            ${topTag}
            <small class="muted">${escapeHtml(ts ? fmtDateTimePOS(ts) : '—')}</small>
          </div>
          <div class="cashv2-move-note">${escapeHtml(note || '—')}</div>
        </div>
        <div class="cashv2-move-amt">${escapeHtml(sign)} ${escapeHtml(sym)} ${escapeHtml(cashV2FmtMoney(shown))}</div>
      </div>
    `);
  }
  return `<div class="cashv2-move-list">${rows.join('')}</div>`;
}

function cashV2HistRenderSnapshot(snapshot){
  const snap = (snapshot && typeof snapshot === 'object') ? snapshot : null;
  if (!snap || !snap.data || typeof snap.data !== 'object'){
    return '<div class="warn"><small>Snapshot inválido.</small></div>';
  }
  const d = snap.data;
  const nio = (d.NIO && typeof d.NIO === 'object') ? d.NIO : {};
  const usd = (d.USD && typeof d.USD === 'object') ? d.USD : {};
  const meta = (d.meta && typeof d.meta === 'object') ? d.meta : {};

  const sumN = cashV2HistBuildSummaryTable('NIO', nio);
  const sumU = cashV2HistBuildSummaryTable('USD', usd);

  const movHtml = cashV2HistRenderMovements(nio.movements, usd.movements);

  const denomN = `
    <div class="cashv2-hist-section">
      <h5>C$ (NIO)</h5>
      <div class="cashv2-hist-grid2">
        ${cashV2HistDenomTable('NIO','Inicial', nio.initial || {})}
        ${cashV2HistDenomTable('NIO','Final', nio.finalCount || {})}
      </div>
    </div>
  `;
  const denomU = `
    <div class="cashv2-hist-section">
      <h5>USD</h5>
      <div class="cashv2-hist-grid2">
        ${cashV2HistDenomTable('USD','Inicial', usd.initial || {})}
        ${cashV2HistDenomTable('USD','Final', usd.finalCount || {})}
      </div>
    </div>
  `;

  const auditHtml = cashV2HistRenderAudit(meta && meta.audit);

  return `
    <div class="cashv2-hist-detail-body" id="cashv2-hist-detail-body-inner">
      <div class="cashv2-hist-section">
        <h4>Tablero resumen (solo lectura)</h4>
        <div class="cashv2-hist-grid2">
          <div>
            <h5>C$ (NIO)</h5>
            ${sumN}
          </div>
          <div>
            <h5>USD</h5>
            ${sumU}
          </div>
        </div>
      </div>

      <div class="cashv2-hist-section">
        <h4>Movimientos</h4>
        ${movHtml}
      </div>

      <div class="cashv2-hist-section">
        <h4>Conteo por denominaciones</h4>
        ${denomN}
        ${denomU}
      </div>

      <div class="cashv2-hist-section">
        <h4>Auditoría</h4>
        ${auditHtml}
      </div>
    </div>
  `;
}

async function cashV2OpenHistDetail(eventId, dayKey, wantV){
  const eid = String(eventId || '').trim();
  const dk = safeYMD(dayKey);
  if (!eid || !dk) return;

  cashV2HistShowDetailView();

  const hdDay = document.getElementById('cashv2-hist-detail-day');
  const hdSt = document.getElementById('cashv2-hist-detail-status');
  const hdEv = document.getElementById('cashv2-hist-detail-event');
  const noSnap = document.getElementById('cashv2-hist-detail-nosnap');
  const vBox = document.getElementById('cashv2-hist-version-box');
  const vBtns = document.getElementById('cashv2-hist-version-buttons');
  const vMeta = document.getElementById('cashv2-hist-version-meta');
  const body = document.getElementById('cashv2-hist-detail-body');

  try{ if (hdDay) hdDay.textContent = dk; }catch(_){ }
  try{ if (hdEv) hdEv.textContent = cashV2HistEventLabel(__CASHV2_HIST_EVMAP, eid); }catch(_){ try{ if (hdEv) hdEv.textContent = `Evento #${eid}`; }catch(__){ } }

  try{ if (body) body.innerHTML = ''; }catch(_){ }
  try{ if (noSnap) noSnap.style.display = 'none'; }catch(_){ }
  try{ if (vBox) vBox.style.display = 'none'; }catch(_){ }
  try{ if (vMeta) vMeta.textContent = ''; }catch(_){ }

  let hist = null;
  try{ hist = await loadHistDay(eid, dk); }catch(_){ hist = null; }
  const status = hist && hist.status ? hist.status : 'OPEN';
  cashV2HistSetStatusPill(hdSt, status);

  let versions = [];
  try{ versions = await listSnapshots(eid, dk); if (!Array.isArray(versions)) versions = []; }catch(_){ versions = []; }

  if (!versions.length){
    // OPEN o CLOSED sin snapshots
    try{ if (noSnap) noSnap.style.display = 'block'; }catch(_){ }
    try{
      const msg = (String(status||'').toUpperCase() === 'OPEN') ? 'Día abierto. Aún no hay cierre/snapshot.' : 'Aún no hay cierre/snapshot.';
      if (body) body.innerHTML = '<div class="muted"><small>' + escapeHtml(msg) + '</small></div>';
    }catch(_){ }
    __CASHV2_HIST_DETAIL_STATE = { eventId: eid, dayKey: dk, v: null };
    return;
  }

  const maxV = Math.max.apply(null, versions);
  let selV = Number(wantV);
  if (!Number.isFinite(selV) || versions.indexOf(Math.trunc(selV)) === -1) selV = maxV;
  selV = Math.trunc(selV);

  __CASHV2_HIST_DETAIL_STATE = { eventId: eid, dayKey: dk, v: selV };

  // Version buttons
  try{
    if (vBtns){
      const parts = [];
      for (const v of versions){
        const vv = Math.trunc(Number(v));
        if (!Number.isFinite(vv) || vv <= 0) continue;
        const cls = (vv === selV) ? 'btn-outline btn-pill btn-pill-mini active' : 'btn-outline btn-pill btn-pill-mini';
        parts.push(`<button type="button" class="${cls}" data-v="${escapeHtml(String(vv))}">v${escapeHtml(String(vv))}</button>`);
      }
      vBtns.innerHTML = parts.join('');
    }
  }catch(_){ }
  try{ if (vBox) vBox.style.display = 'block'; }catch(_){ }

  // Load snapshot
  let snap = null;
  try{ snap = await loadSnapshot(eid, dk, selV); }catch(_){ snap = null; }
  if (!snap){
    try{ if (body) body.innerHTML = '<div class="warn"><small>No se encontró el snapshot.</small></div>'; }catch(_){ }
    return;
  }

  // Meta line
  try{
    const ts = cashV2HistSafeTs(snap && snap.ts);
    const stp = ts ? fmtDateTimePOS(ts) : '—';
    const ct = hist && hist.closeTs ? fmtDateTimePOS(cashV2HistSafeTs(hist.closeTs)) : '—';
    if (vMeta) vMeta.textContent = `Snapshot: ${stp} · Cerrado: ${ct}`;
  }catch(_){ }

  const html = cashV2HistRenderSnapshot(snap);
  try{ if (body) body.innerHTML = html; }catch(_){ }
}

let __CASHV2_HIST_UI_ONCE = false;
function cashV2InitHistUIOnce(){
  if (__CASHV2_HIST_UI_ONCE) return;
  const btn = document.getElementById('cashv2-btn-hist');
  if (!btn) return;
  const closeBtn = document.getElementById('cashv2-hist-close');
  const backBtn = document.getElementById('cashv2-hist-back');
  const expDayBtn = document.getElementById('cashv2-hist-export-day');
  const vBtns = document.getElementById('cashv2-hist-version-buttons');
  const modalId = 'cashv2-hist-modal';

  btn.addEventListener('click', async()=>{
    try{ openModalPOS(modalId); }catch(_){ }
    try{ cashV2HistShowListView(); }catch(_){ }
    try{ await cashV2RenderHistModal(); }catch(err){ console.error(err); }
  });
  if (closeBtn){
    closeBtn.addEventListener('click', ()=>{
      try{ cashV2HistShowListView(); }catch(_){ }
      try{ closeModalPOS(modalId); }catch(_){ }
    });
  }
  if (backBtn){
    backBtn.addEventListener('click', ()=>{ try{ cashV2HistShowListView(); }catch(_){ } });
  }
  if (expDayBtn){
    expDayBtn.addEventListener('click', ()=>{
      cashV2ExportHistExcelDay().catch(err=>{
        console.error(err);
        try{ showToast('No se pudo exportar el Excel.', 'error', 4500); }catch(_){ }
      });
    });
  }
  if (vBtns && vBtns.dataset.ready !== '1'){
    vBtns.addEventListener('click', (ev)=>{
      const b = ev && ev.target ? ev.target.closest('button[data-v]') : null;
      if (!b) return;
      const v = Number(b.dataset.v);
      if (!Number.isFinite(v)) return;
      const st = __CASHV2_HIST_DETAIL_STATE;
      if (!st || !st.eventId || !st.dayKey) return;
      cashV2OpenHistDetail(st.eventId, st.dayKey, v).catch(err=>console.error(err));
    });
    vBtns.dataset.ready = '1';
  }

  __CASHV2_HIST_UI_ONCE = true;
}

async function cashV2RenderHistModal(){
  const listEl = document.getElementById('cashv2-hist-list');
  const emptyEl = document.getElementById('cashv2-hist-empty');
  const errEl = document.getElementById('cashv2-hist-error');
  if (!listEl) return;

  try{ cashV2HistShowListView(); }catch(_){ }
  try{ listEl.innerHTML = ''; }catch(_){ }
  try{ if (emptyEl) emptyEl.style.display = 'none'; }catch(_){ }
  try{
    if (errEl){
      errEl.style.display = 'none';
      const sm = errEl.querySelector('small');
      if (sm) sm.textContent = '';
    }
  }catch(_){ }

  let eventsMeta = [];
  try{ eventsMeta = await listHistEvents(); if (!Array.isArray(eventsMeta)) eventsMeta = []; }catch(err){
    console.error('[A33][CASHv2][HIST] listHistEvents', err);
    try{
      if (errEl){
        const sm = errEl.querySelector('small');
        if (sm) sm.textContent = 'No se pudo cargar el histórico.';
        errEl.style.display = 'block';
      }
    }catch(_){ }
    eventsMeta = [];
  }

  if (!eventsMeta.length){
    try{ if (emptyEl) emptyEl.style.display = 'block'; }catch(_){ }
    return;
  }

  // Nombres de eventos (si existen)
  let evs = [];
  try{ evs = await getAll('events'); if (!Array.isArray(evs)) evs = []; }catch(_){ evs = []; }
  const evMap = new Map();
  for (const e of (evs || [])){
    try{ if (e && e.id != null) evMap.set(String(e.id), e); }catch(_){ }
  }

  try{ __CASHV2_HIST_EVMAP = evMap; }catch(_){ }

  for (const meta of (eventsMeta || [])){
    const eid = String(meta && meta.eventId || '').trim();
    if (!eid) continue;

    const wrap = document.createElement('div');
    wrap.className = 'cashv2-hist-event';

    const head = document.createElement('div');
    head.className = 'cashv2-hist-event-head';

    const title = document.createElement('h4');
    title.textContent = cashV2HistEventLabel(evMap, eid);

    const when = document.createElement('div');
    when.className = 'muted';
    const ts = cashV2HistSafeTs(meta && meta.lastUpdatedTs);
    const whenSmall = document.createElement('small');
    whenSmall.textContent = ts ? ('Actualizado: ' + fmtDateTimePOS(ts)) : 'Actualizado: —';
    when.appendChild(whenSmall);

    head.appendChild(title);
    head.appendChild(when);

    // Etapa 5/5: Exportar Excel (Evento)
    try{
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.style.gap = '8px';
      actions.style.flexWrap = 'wrap';
      actions.style.alignItems = 'center';

      const btnExport = document.createElement('button');
      btnExport.type = 'button';
      btnExport.className = 'btn-outline btn-pill btn-pill-mini';
      btnExport.textContent = 'Exportar Excel (Evento)';
      btnExport.addEventListener('click', async()=>{
        if (btnExport.disabled) return;
        btnExport.disabled = true;
        try{ await cashV2ExportHistExcelEvent(eid); }
        catch(err){ console.error(err); try{ showToast('No se pudo exportar el Excel.', 'error', 4500); }catch(_){ } }
        finally{ btnExport.disabled = false; }
      });
      actions.appendChild(btnExport);
      head.appendChild(actions);
    }catch(_){ }

    wrap.appendChild(head);

    const daysBox = document.createElement('div');
    daysBox.className = 'cashv2-hist-days';

    let days = [];
    try{ days = await listHistDaysForEvent(eid); if (!Array.isArray(days)) days = []; }catch(_){ days = []; }

    if (!days.length){
      const m = document.createElement('div');
      m.className = 'muted';
      const sm = document.createElement('small');
      sm.textContent = 'Sin días registrados.';
      m.appendChild(sm);
      daysBox.appendChild(m);
    }else{
      for (const d of (days || [])){
        const dayKey = safeYMD(d && d.dayKey);
        if (!dayKey) continue;

        const row = document.createElement('div');
        row.className = 'cashv2-hist-day';

        const left = document.createElement('div');
        left.className = 'cashv2-hist-day-left';

        const dk = document.createElement('div');
        dk.className = 'cashv2-hist-daykey';
        dk.textContent = dayKey;

        const st = cashV2StatusToUiPOS(d && d.status);
        const tag = document.createElement('span');
        tag.className = 'tag ' + (st && st.cls ? st.cls : 'open');
        tag.textContent = (st && st.text) ? st.text : 'Abierto';

        const vCount = (d && Array.isArray(d.versions)) ? d.versions.length : 0;
        const v = document.createElement('span');
        v.className = 'cashv2-hist-versions';
        v.textContent = (vCount > 0) ? ('v' + String(vCount)) : '—';

        left.appendChild(dk);
        left.appendChild(tag);
        left.appendChild(v);

        const actions = document.createElement('div');
        actions.className = 'actions end';
        actions.style.gap = '8px';
        actions.style.alignItems = 'center';
        actions.style.flexWrap = 'wrap';

        const btnDetail = document.createElement('button');
        btnDetail.type = 'button';
        btnDetail.className = 'btn-outline btn-pill btn-pill-mini';
        btnDetail.textContent = 'Ver detalle';
        btnDetail.addEventListener('click', ()=>{
          cashV2OpenHistDetail(eid, dayKey).catch(err=>{
            console.error(err);
            try{ toast('No se pudo abrir detalle.'); }catch(_){ }
          });
        });
        actions.appendChild(btnDetail);

        row.appendChild(left);
        row.appendChild(actions);
        daysBox.appendChild(row);
      }
    }

    wrap.appendChild(daysBox);
    listEl.appendChild(wrap);
  }
}

// --- POS: Efectivo v2 — Histórico: Export Excel (multi-hoja) — Etapa 5/5
function cashV2HistExcelEnsureXLSX(){
  if (typeof XLSX === 'undefined'){
    throw new Error('No se pudo generar el Excel (XLSX no cargado). Si es tu primera carga offline: abrí el POS una vez con internet para cachear y reintentá.');
  }
}

function cashV2HistExcelApply2Dec(ws, cols2dec, startRowIdx){
  try{
    if (!ws || !ws['!ref'] || !Array.isArray(cols2dec) || !cols2dec.length) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const start = Number.isFinite(Number(startRowIdx)) ? Math.max(0, Math.trunc(Number(startRowIdx))) : 1;
    for (let r = start; r <= range.e.r; r++){
      for (const c0 of cols2dec){
        const c = Math.trunc(Number(c0));
        if (!Number.isFinite(c) || c < 0) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell || cell.t !== 'n') continue;
        cell.z = '0.00';
      }
    }
  }catch(_){ }
}

function cashV2HistWriteWorkbookExcel(filename, sheets, fmtSpecByName){
  cashV2HistExcelEnsureXLSX();
  const wb = XLSX.utils.book_new();
  for (const sh of (sheets || [])){
    const name = String(sh && sh.name || 'Hoja').slice(0, 31);
    const ws = XLSX.utils.aoa_to_sheet((sh && sh.rows) ? sh.rows : []);
    try{
      const spec = (fmtSpecByName && fmtSpecByName[name]) ? fmtSpecByName[name] : null;
      if (spec && Array.isArray(spec.cols2dec)) cashV2HistExcelApply2Dec(ws, spec.cols2dec, spec.startRowIdx);
    }catch(_){ }
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, filename);
}

function cashV2HistExcelSnapToSummaryRow(eid, dk, v, snap){
  const s = (snap && typeof snap === 'object') ? snap : {};
  const d = (s.data && typeof s.data === 'object') ? s.data : {};
  const N = (d.NIO && typeof d.NIO === 'object') ? d.NIO : {};
  const U = (d.USD && typeof d.USD === 'object') ? d.USD : {};

  const nInit = cashV2Round2Money((N.initial && N.initial.total) || 0);
  const nIn = cashV2Round2Money(cashV2HistSumMoves(N.movements, 'IN'));
  const nOut = cashV2Round2Money(cashV2HistSumMoves(N.movements, 'OUT'));
  const nAdj = cashV2Round2Money(cashV2HistSumMoves(N.movements, 'ADJUST'));
  const nSales = cashV2Round2Money(N.cashSalesC$ || 0);
  const nExp = cashV2Round2Money(N.expected || 0);
  const nFinal = cashV2Round2Money((N.finalCount && N.finalCount.total) || 0);
  const nDiff = cashV2Round2Money(N.diff || 0);

  const uInit = cashV2Round2Money((U.initial && U.initial.total) || 0);
  const uIn = cashV2Round2Money(cashV2HistSumMoves(U.movements, 'IN'));
  const uOut = cashV2Round2Money(cashV2HistSumMoves(U.movements, 'OUT'));
  const uAdj = cashV2Round2Money(cashV2HistSumMoves(U.movements, 'ADJUST'));
  const uSales = cashV2Round2Money(U.cashSalesUSD || 0);
  const uExp = cashV2Round2Money(U.expected || 0);
  const uFinal = cashV2Round2Money((U.finalCount && U.finalCount.total) || 0);
  const uDiff = cashV2Round2Money(U.diff || 0);

  let snapAt = '';
  try{ snapAt = s.ts ? fmtDateTimePOS(cashV2HistSafeTs(s.ts)) : ''; }catch(_){ snapAt = ''; }

  return [
    String(eid), String(dk), Math.trunc(Number(v)), snapAt,
    nInit, nIn, nOut, nSales, nAdj, nExp, nFinal, nDiff,
    uInit, uIn, uOut, uSales, uAdj, uExp, uFinal, uDiff
  ];
}

function cashV2HistExcelBuildSheetsFromSnapshots(snapshotTuples){
  const resumen = [[
    'eventId','dayKey','v','snapshotTs',
    'NIO_Inicial','NIO_Entradas','NIO_Salidas','NIO_VentasC$','NIO_Ajuste','NIO_Esperado','NIO_Final','NIO_Dif',
    'USD_Inicial','USD_Entradas','USD_Salidas','USD_Ventas','USD_Ajuste','USD_Esperado','USD_Final','USD_Dif'
  ]];

  const movs = [['eventId','dayKey','v','currency','kind','amount','ts','note','id']];
  const conteo = [['eventId','dayKey','v','currency','block','denom','count','subtotal','total']];
  const audit = [['eventId','dayKey','v','ts','action','reason']];

  const tuples = Array.isArray(snapshotTuples) ? snapshotTuples.slice() : [];
  tuples.sort((a,b)=>{
    const ae = String(a && a.eventId || '');
    const be = String(b && b.eventId || '');
    if (ae !== be) return ae.localeCompare(be);
    const ad = String(a && a.dayKey || '');
    const bd = String(b && b.dayKey || '');
    if (ad !== bd) return ad.localeCompare(bd);
    const av = Number(a && a.v || 0);
    const bv = Number(b && b.v || 0);
    return av - bv;
  });

  for (const it of tuples){
    const eid = String(it && it.eventId || '').trim();
    const dk = safeYMD(it && it.dayKey);
    const v = Math.trunc(Number(it && it.v));
    const snap = (it && it.snap) ? it.snap : null;
    if (!eid || !dk || !snap || !Number.isFinite(v) || v <= 0) continue;

    // Resumen
    try{ resumen.push(cashV2HistExcelSnapToSummaryRow(eid, dk, v, snap)); }catch(_){ }

    // Movimientos
    try{
      const d = (snap.data && typeof snap.data === 'object') ? snap.data : {};
      const N = (d.NIO && typeof d.NIO === 'object') ? d.NIO : {};
      const U = (d.USD && typeof d.USD === 'object') ? d.USD : {};
      const addMovs = (arr, ccy)=>{
        for (const m of (arr || [])){
          const mm = cashV2HistNormalizeMove(m);
          const ts = mm.ts ? fmtDateTimePOS(cashV2HistSafeTs(mm.ts)) : '';
          movs.push([eid, dk, v, ccy, mm.kind, cashV2Round2Money(mm.amount || 0), ts, (mm.note || ''), (mm.id || '')]);
        }
      };
      addMovs(N.movements, 'NIO');
      addMovs(U.movements, 'USD');
    }catch(_){ }

    // Conteo (Inicial y Final)
    try{
      const d = (snap.data && typeof snap.data === 'object') ? snap.data : {};
      const blocks = [
        { ccy:'NIO', name:'Inicial', obj: (d.NIO && d.NIO.initial) ? d.NIO.initial : null },
        { ccy:'USD', name:'Inicial', obj: (d.USD && d.USD.initial) ? d.USD.initial : null },
        { ccy:'NIO', name:'Final', obj: (d.NIO && d.NIO.finalCount) ? d.NIO.finalCount : null },
        { ccy:'USD', name:'Final', obj: (d.USD && d.USD.finalCount) ? d.USD.finalCount : null }
      ];
      for (const b of blocks){
        const ccy = b.ccy;
        const blk = b.obj;
        if (!blk) continue;
        const denoms = CASHV2_DENOMS[ccy] || [];
        const counts = normalizeDenomCounts(ccy, blk.denomCounts || {});
        const total = cashV2Round2Money(blk.total || 0);
        for (const denom of denoms){
          const k = String(denom);
          const cnt = cashV2NormCount(counts[k]);
          const sub = cashV2Round2Money(Number(denom) * Number(cnt));
          conteo.push([eid, dk, v, ccy, b.name, Number(denom), cnt, sub, total]);
        }
      }
    }catch(_){ }

    // Auditoría
    try{
      const meta = (snap.data && snap.data.meta) ? snap.data.meta : {};
      const rows = Array.isArray(meta.audit) ? meta.audit : [];
      for (const a of rows){
        const tsn = cashV2HistSafeTs(a && a.ts);
        const ts = tsn ? fmtDateTimePOS(tsn) : '';
        const action = (a && a.action != null) ? String(a.action) : '';
        const reason = (a && a.reason != null) ? String(a.reason) : '';
        audit.push([eid, dk, v, ts, action, reason]);
      }
    }catch(_){ }
  }

  const sheets = [
    { name:'Resumen', rows: resumen },
    { name:'Movimientos', rows: movs },
    { name:'Conteo', rows: conteo },
    { name:'Auditoria', rows: audit }
  ];

  const fmt = {
    'Resumen': { startRowIdx: 1, cols2dec: [4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19] },
    'Movimientos': { startRowIdx: 1, cols2dec: [5] },
    'Conteo': { startRowIdx: 1, cols2dec: [7,8] }
  };

  return { sheets, fmt };
}

async function cashV2ExportHistExcelEvent(eventId){
  const eid = String(eventId || '').trim();
  if (!eid){ try{ showToast('Evento inválido.', 'warn', 3000); }catch(_){ } return; }

  let days = [];
  try{ days = await listHistDaysForEvent(eid); if (!Array.isArray(days)) days = []; }catch(_){ days = []; }
  if (!days.length){ try{ showToast('Sin días en el histórico.', 'warn', 3000); }catch(_){ } return; }

  const tuples = [];
  let openOrNoSnap = 0;
  for (const d of (days || [])){
    const dk = safeYMD(d && d.dayKey);
    if (!dk) continue;
    let versions = [];
    try{ versions = await listSnapshots(eid, dk); if (!Array.isArray(versions)) versions = []; }catch(_){ versions = []; }
    if (!versions.length){ openOrNoSnap++; continue; }
    for (const v of versions){
      const vv = Math.trunc(Number(v));
      if (!Number.isFinite(vv) || vv <= 0) continue;
      let snap = null;
      try{ snap = await loadSnapshot(eid, dk, vv); }catch(_){ snap = null; }
      if (!snap) continue;
      tuples.push({ eventId: eid, dayKey: dk, v: vv, snap });
    }
  }

  if (!tuples.length){
    try{ showToast('Sin cierres/snapshots para exportar.', 'warn', 3500); }catch(_){ }
    return;
  }

  const today = safeYMD(getTodayDayKey());
  const ymd = String(today || '').replace(/-/g,'');
  const filename = `A33_EfectivoHistorico_evento_${eid}_${ymd}.xlsx`;

  const { sheets, fmt } = cashV2HistExcelBuildSheetsFromSnapshots(tuples);
  cashV2HistWriteWorkbookExcel(filename, sheets, fmt);

  try{
    const extra = openOrNoSnap ? ` · ${openOrNoSnap} día(s) OPEN sin cierre` : '';
    showToast(`Excel exportado (${tuples.length} snapshot(s))${extra}.`, 'ok', 4200);
  }catch(_){ }
}

async function cashV2ExportHistExcelDay(){
  const st = __CASHV2_HIST_DETAIL_STATE;
  const eid = st && st.eventId ? String(st.eventId).trim() : '';
  const dk = st && st.dayKey ? safeYMD(st.dayKey) : '';
  const vv = st && st.v ? Math.trunc(Number(st.v)) : 0;
  if (!eid || !dk || !Number.isFinite(vv) || vv <= 0){
    try{ showToast('Sin cierre. No hay snapshot para exportar.', 'warn', 3500); }catch(_){ }
    return;
  }
  let snap = null;
  try{ snap = await loadSnapshot(eid, dk, vv); }catch(_){ snap = null; }
  if (!snap){
    try{ showToast('Sin cierre. No hay snapshot para exportar.', 'warn', 3500); }catch(_){ }
    return;
  }

  const filename = `A33_EfectivoHistorico_${eid}_${dk}_v${String(vv).padStart(2,'0')}.xlsx`;
  const { sheets, fmt } = cashV2HistExcelBuildSheetsFromSnapshots([{ eventId: eid, dayKey: dk, v: vv, snap }]);
  cashV2HistWriteWorkbookExcel(filename, sheets, fmt);
  try{ showToast('Excel exportado.', 'ok', 3000); }catch(_){ }
}


async function renderEfectivoTab(){
  const tab = document.getElementById('tab-efectivo');
  if (!tab) return;

  const statusTag = document.getElementById('cashv2-status-tag');
  const elEventId = document.getElementById('cashv2-eventid');
  const elDayKey = document.getElementById('cashv2-daykey');
  const elOpenAt = document.getElementById('cashv2-opened-at');
  const elNoEvent = document.getElementById('cashv2-no-event');
  const elBlocked = document.getElementById('cashv2-blocked-note');
  const elErr = document.getElementById('cashv2-error');
  const selEvent = document.getElementById('cashv2-event-select');
  const togEnabled = document.getElementById('cashv2-event-enabled');
  const togHint = document.getElementById('cashv2-event-enabled-hint');
  const elMultiNote = document.getElementById('cashv2-multiday-note');
  const elMultiActions = document.getElementById('cashv2-multiday-actions');
  const btnOpenFromY = document.getElementById('cashv2-btn-open-from-yesterday');

  // Etapa 3: UI Inicio (denominaciones)
  cashV2InitInitialUIOnce();
  // Etapa 4: Movimientos
  cashV2InitMovementsUIOnce();
  // Etapa 5: Cierre (Final + esperado + diferencia)
  cashV2InitFinalUIOnce();
  cashV2InitMultiDayUIOnce();
  // Etapa 6: Cierre duro (no cerrar con diferencia)
  cashV2InitCloseUIOnce();
  // Etapa 5/5: Reabrir (Admin) + auditoría
  cashV2InitAdminReopenUIOnce();
  // Etapa 1/7: selector + activador
  cashV2InitEventSelectorUIOnce();

  // Etapa 3/5: Histórico (UI listado solo lectura)
  cashV2InitHistUIOnce();

  // Etapa 3/7: Tipo de cambio
  cashV2InitFxUIOnce();

  // Etapa 2/3: UX inputs (vacío primero + select-all reingreso)
  cashV2InitUXInputsOnce();

  // Reset UI
  try{ if (tab){ tab.classList.remove('cashv2-readonly'); tab.classList.remove('cashv2-closed'); } }catch(_){ }
  try{ if (elErr){ elErr.style.display = 'none'; elErr.textContent = ''; } }catch(_){ }
  try{ if (elNoEvent){ elNoEvent.style.display = 'none'; } }catch(_){ }
  try{ if (elBlocked){ elBlocked.style.display = 'none'; } }catch(_){ }
  try{ if (elMultiNote){ elMultiNote.style.display = 'none'; const sm = elMultiNote.querySelector('small'); if (sm) sm.textContent = ''; } }catch(_){ }
  try{ if (elMultiActions){ elMultiActions.style.display = 'none'; } }catch(_){ }
  try{ if (btnOpenFromY){ btnOpenFromY.style.display = 'none'; btnOpenFromY.dataset.eventId = ''; btnOpenFromY.dataset.todayKey = ''; } }catch(_){ }

  const todayKey = safeYMD(getTodayDayKey());
  let dayKey = todayKey;
  try{ if (elDayKey) elDayKey.textContent = dayKey; }catch(_){ }
  try{ if (elOpenAt) elOpenAt.textContent = '—'; }catch(_){ }

  let activeEventId = null;
  try{ activeEventId = await getMeta('currentEventId'); }catch(_){ activeEventId = null; }

  // Cargar TODOS los eventos para selector
  let allEvents = [];
  try{ allEvents = await getAll('events'); if (!Array.isArray(allEvents)) allEvents = []; }catch(_){ allEvents = []; }

  // Selección local (Efectivo) NO afecta el evento global
  let viewEventId = '';
  try{ viewEventId = String(cashV2GetViewEventId() || '').trim(); }catch(_){ viewEventId = ''; }
  if (!viewEventId){
    try{ viewEventId = (activeEventId == null) ? '' : String(activeEventId).trim(); }catch(_){ viewEventId = ''; }
  }
  if (viewEventId && !allEvents.some(e=>e && String(e.id)===String(viewEventId))){
    // Si el id guardado ya no existe, caemos al evento activo o a vacío.
    try{ viewEventId = (activeEventId == null) ? '' : String(activeEventId).trim(); }catch(_){ viewEventId = ''; }
    if (viewEventId && !allEvents.some(e=>e && String(e.id)===String(viewEventId))) viewEventId = '';
  }

  // Render selector
  try{
    if (selEvent){
      const cur = String(viewEventId || '');
      const act = (activeEventId == null) ? '' : String(activeEventId).trim();
      const sorted = (allEvents || []).slice().sort((a,b)=>{
        const ad = a && a.createdAt ? String(a.createdAt) : '';
        const bd = b && b.createdAt ? String(b.createdAt) : '';
        return (bd > ad) ? 1 : (bd < ad ? -1 : 0);
      });
      const opts = ['<option value="">— Selecciona evento —</option>'];
      for (const ev of sorted){
        if (!ev || ev.id == null) continue;
        const id = String(ev.id);
        const name = (ev.name != null ? String(ev.name) : ('Evento ' + id)).trim();
        const isActive = (act && id === act);
        const flag = cashV2GetFlagForEventObj(ev);
        const badges = [isActive ? 'Activo' : 'Inactivo (solo lectura)'];
        if (!flag) badges.push('Efectivo OFF');
        const label = `${name} · ${badges.join(' · ')} (#${id})`;
        opts.push(`<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`);
      }
      selEvent.innerHTML = opts.join('');
      selEvent.value = cur;
    }
  }catch(_){ }

  // Si no hay selección, dejar en modo vacío
  const eventId = String((selEvent && selEvent.value) ? selEvent.value : (viewEventId || '')).trim();
  if (!eventId){
    try{ if (elEventId) elEventId.textContent = '—'; }catch(_){ }
    try{
      if (statusTag){
        statusTag.textContent = 'Abierto';
        statusTag.classList.add('open');
        statusTag.classList.remove('closed');
      }
    }catch(_){ }
    try{ if (elNoEvent){ elNoEvent.style.display = 'block'; } }catch(_){ }
    try{ if (elOpenAt) elOpenAt.textContent = '—'; }catch(_){ }
    
    // Etapa 3/7: sin evento => oculta Tipo de cambio
    try{
      const fx = document.getElementById('cashv2-fx-card');
      if (fx){ fx.style.display = 'none'; fx.dataset.eventId=''; fx.dataset.dayKey=dayKey; fx.dataset.readonly='1'; }
    }catch(_){ }
    try{ cashV2SetFxEnabled(false); }catch(_){ }
    try{ cashV2ApplyFxToDom(null, '', null); }catch(_){ }
// Etapa 3: sin evento => oculta Inicio y bloquea controles
    try{
      const fx = document.getElementById('cashv2-fx-card');
      if (fx){ fx.style.display = 'none'; fx.dataset.eventId=''; fx.dataset.dayKey=dayKey; fx.dataset.readonly='1'; }
    }catch(_){ }
    try{
      const card = document.getElementById('cashv2-initial-card');
      if (card){ card.style.display = 'none'; card.dataset.eventId = ''; card.dataset.dayKey = dayKey; }
    }catch(_){ }
    try{ cashV2SetInitialEnabled(false); }catch(_){ }
    try{ cashV2ApplyInitialToDom(null); }catch(_){ }
    // Etapa 4: sin evento => oculta Movimientos
    try{
      const mcard = document.getElementById('cashv2-movements-card');
      if (mcard){ mcard.style.display = 'none'; mcard.dataset.eventId=''; mcard.dataset.dayKey=dayKey; }
    }catch(_){ }
    try{ cashV2RenderMovementsUI({movements:[]}); }catch(_){ }
    // Etapa 5: sin evento => oculta Cierre
    try{
      const fcard = document.getElementById('cashv2-final-card');
      if (fcard){ fcard.style.display = 'none'; fcard.dataset.eventId=''; fcard.dataset.dayKey=dayKey; fcard.dataset.blocked='1'; fcard.dataset.locked='0'; }
    }catch(_){ }
    try{ cashV2SetFinalEnabled(false); }catch(_){ }
    try{ cashV2ApplyFinalToDom(null); }catch(_){ }
    try{ cashV2SetLastRec(null); }catch(_){ }
    try{ cashV2ClearCloseSummary(); }catch(_){ }
    try{ cashV2UpdateCloseEligibility(null); }catch(_){ }
    try{ cashV2ApplyCashSalesToDom(null); }catch(_){ }
    return;
  }


  // Día operativo = fecha de apertura (openTs). No cambia aunque el cierre ocurra después de medianoche.
  try{
    dayKey = await cashV2ResolveOperationalDayKey(eventId, dayKey);
    if (elDayKey) elDayKey.textContent = dayKey;
  }catch(_){ }

  // Estado ACTIVO/INACTIVO del evento (activo = evento global del POS)
  const isActiveEvent = (activeEventId != null && String(activeEventId).trim() === String(eventId));
  const evObj = allEvents.find(e=>e && String(e.id)===String(eventId)) || null;
  const flagOn = cashV2GetFlagForEventObj(evObj);
  const blocked = (!isActiveEvent) || (isActiveEvent && !flagOn);

  // UI selector: toggle habilitado solo si el evento es ACTIVO
  try{
    if (togEnabled){
      togEnabled.checked = !!flagOn;
      togEnabled.disabled = !isActiveEvent;
    }
  }catch(_){ }
  try{
    if (togHint){
      if (!isActiveEvent) togHint.textContent = 'Evento inactivo: solo lectura';
      else if (!flagOn) togHint.textContent = 'Efectivo OFF: activa para editar';
      else togHint.textContent = 'Efectivo activo: editable';
    }
  }catch(_){ }

  try{ cashV2RenderEventBadgesUI({ isActive: isActiveEvent, isInactive: !isActiveEvent, isOff: !flagOn }); }catch(_){ }

  try{ if (elBlocked) elBlocked.style.display = blocked ? 'block' : 'none'; }catch(_){ }

  // Mostrar evento seleccionado (más útil que solo el id)
  try{
    if (elEventId){
      const nm = (evObj && evObj.name != null) ? String(evObj.name).trim() : '';
      elEventId.textContent = nm ? (nm + ' (#' + String(eventId) + ')') : String(eventId);
    }
  }catch(_){ }

  // Ventas en efectivo físicas por moneda (C$ normal + USD recibido con vuelto C$)
  let cashSalesC = 0;
  let cashSalesUSD = 0;
  try{
    const phys = await cashV2ComputeCashSalesPhysicalPOS(eventId, dayKey);
    cashSalesC = cashV2Round2Money(phys && phys.NIO);
    cashSalesUSD = cashV2Round2Money(phys && phys.USD);
  }catch(_){ cashSalesC = 0; cashSalesUSD = 0; }
  try{ cashV2ApplyCashSalesToDom(cashSalesC, cashSalesUSD); }catch(_){ }

  try{
    let locked = false;
    try{ locked = await isDayLocked(eventId, dayKey); }catch(_){ locked = false; }
    if (locked){
      const lk = `${eventId}|${dayKey}`;
      if (!__CASHV2_LOCK_LOG_ONCE.has(lk)){
        __CASHV2_LOCK_LOG_ONCE.add(lk);
        if (typeof window !== 'undefined' && window.A33_DEBUG_CASHV2) console.info(`[A33][CASHv2] lock detected ${eventId} ${dayKey}`);
      }
    }

    // Propagar estado a UI (para que el cierre sea hard-stop incluso si alguien dispara el handler).
    try{
      const fcard = document.getElementById('cashv2-final-card');
      if (fcard){
        fcard.dataset.blocked = blocked ? '1' : '0';
        fcard.dataset.locked = locked ? '1' : '0';
      }
    }catch(_){ }
    try{
      const b = document.getElementById('cashv2-btn-close');
      if (b){
        b.dataset.blocked = blocked ? '1' : '0';
        b.dataset.locked = locked ? '1' : '0';
      }
    }catch(_){ }

    // Regla: si está BLOQUEADO (evento inactivo o flag OFF), solo lectura => no ensure (no writes)
    const editable = (!!isActiveEvent && !!flagOn);

    // Multi-día: si el día operativo NO es hoy, el último día está ABIERTO => aviso.
    try{
      if (elMultiNote){
        const sm = elMultiNote.querySelector('small');
        if (dayKey !== todayKey){
          elMultiNote.style.display = 'block';
          if (sm) sm.textContent = 'Primero cierra el día anterior.';
        }else{
          elMultiNote.style.display = 'none';
          if (sm) sm.textContent = '';
        }
      }
      if (elMultiActions) elMultiActions.style.display = 'none';
      if (btnOpenFromY){
        btnOpenFromY.style.display = 'none';
        btnOpenFromY.dataset.eventId = '';
        btnOpenFromY.dataset.todayKey = '';
      }
    }catch(_){ }

    let rec = null;
    let needOpenFromPrev = false;
    let prevDayKey = '';

    // Caso: estamos en "hoy" y aún no existe registro v2 para hoy.
    if (dayKey === todayKey){
      try{ rec = await cashV2Load(eventId, dayKey); }catch(_){ rec = null; }
      if (!rec){
        let prev = null;
        try{ prev = await getLatestDayForEvent(eventId); }catch(_){ prev = null; }
        const pdk = prev ? safeYMD(prev.dayKey || '') : '';
        if (prev && pdk && pdk !== todayKey){
          if (cashV2NormStatus(prev.status) === 'CLOSED'){
            needOpenFromPrev = true;
            prevDayKey = pdk;
          }else{
            // Por seguridad (si un OPEN no fue detectado como operativo)
            try{
              if (elMultiNote){
                const sm = elMultiNote.querySelector('small');
                elMultiNote.style.display = 'block';
                if (sm) sm.textContent = 'Primero cierra el día anterior.';
              }
            }catch(_){ }
          }
        }else{
          // Sin registros previos: flujo normal (crear/ensure)
          if (editable && !locked){
            rec = await cashV2Ensure(eventId, dayKey);
          }
        }
      }else{
        if (editable && !locked){
          rec = await cashV2Ensure(eventId, dayKey);
        }
      }
    }else{
      // Día operativo distinto de hoy: trabajamos sobre ese día (multi-día)
      rec = (editable && !locked) ? await cashV2Ensure(eventId, dayKey) : await cashV2Load(eventId, dayKey);
    }

    if (needOpenFromPrev){
      // UI: botón "Abrir hoy con saldo de ayer" (solo si el último está CERRADO y hoy no existe)
      try{
        if (elMultiNote){
          const sm = elMultiNote.querySelector('small');
          elMultiNote.style.display = 'block';
          if (sm) sm.textContent = `Último día cerrado: ${prevDayKey}.`;
        }
        if (elMultiActions) elMultiActions.style.display = 'flex';
        if (btnOpenFromY){
          btnOpenFromY.style.display = 'inline-flex';
          btnOpenFromY.dataset.eventId = String(eventId);
          btnOpenFromY.dataset.todayKey = todayKey;
          btnOpenFromY.disabled = !(editable && !locked);
        }
      }catch(_){ }

      // FX visible pero deshabilitado (evita crear registro accidentalmente)
      try{
        const fx = document.getElementById('cashv2-fx-card');
        if (fx){ fx.style.display = 'block'; fx.dataset.eventId = String(eventId); fx.dataset.dayKey = dayKey; fx.dataset.readonly = '1'; }
      }catch(_){ }
      try{ cashV2ApplyFxToDom(null, eventId, evObj); }catch(_){ }
      try{ cashV2SetFxEnabled(false); }catch(_){ }

      // Ocultar/inhabilitar el resto hasta abrir el día
      try{
        const card = document.getElementById('cashv2-initial-card');
        if (card){ card.style.display = 'none'; card.dataset.eventId=''; card.dataset.dayKey=dayKey; }
      }catch(_){ }
      try{ cashV2SetInitialEnabled(false); }catch(_){ }
      try{ cashV2ApplyInitialToDom(null); }catch(_){ }

      try{
        const mcard = document.getElementById('cashv2-movements-card');
        if (mcard){ mcard.style.display = 'none'; mcard.dataset.eventId=''; mcard.dataset.dayKey=dayKey; }
      }catch(_){ }
      try{ cashV2RenderMovementsUI({movements:[]}); }catch(_){ }
      try{ cashV2SetMovementsEnabled(false); }catch(_){ }

      try{
        const fcard = document.getElementById('cashv2-final-card');
        if (fcard){ fcard.style.display = 'none'; fcard.dataset.eventId=''; fcard.dataset.dayKey=dayKey; fcard.dataset.blocked='1'; fcard.dataset.locked='0'; }
      }catch(_){ }
      try{ cashV2SetFinalEnabled(false); }catch(_){ }
      try{ cashV2ApplyFinalToDom(null); }catch(_){ }
      try{ cashV2ClearCloseSummary(); }catch(_){ }
      try{ cashV2SetCloseUiState({ canClose:false, reason:'Aún no has abierto el día de hoy' }); }catch(_){ }
      try{ cashV2SetLastRec(null); }catch(_){ }

      // Estado
      try{
        if (statusTag){
          statusTag.textContent = 'Sin abrir';
          statusTag.classList.remove('open');
          statusTag.classList.add('closed');
        }
      }catch(_){ }
      try{ if (elOpenAt) elOpenAt.textContent = '—'; }catch(_){ }
      return;
    }

    try{ if (rec && typeof rec === 'object') { rec.cashSalesC = cashSalesC; rec.cashSalesUSD = cashSalesUSD; } }catch(_){ }
    try{ cashV2SetLastRec(rec); }catch(_){ }

    // Etapa 3/5: mostrar Tipo de cambio conectado al evento activo
    try{
      const fx = document.getElementById('cashv2-fx-card');
      if (fx){ fx.style.display = 'block'; fx.dataset.eventId = String(eventId); fx.dataset.dayKey = dayKey; }
    }catch(_){ }
    try{ await cashV2PromoteLegacyFxToEventIfNeeded(eventId, rec, evObj, editable && !locked); }catch(_){ }
    try{ cashV2ApplyFxToDom(rec, eventId, evObj); }catch(_){ }
    try{
      const card = document.getElementById('cashv2-initial-card');
      if (card){ card.style.display = 'block'; card.dataset.eventId = String(eventId); card.dataset.dayKey = dayKey; }
    }catch(_){ }
    try{ cashV2SetInitialEnabled(true); }catch(_){ }
    try{ cashV2ApplyInitialToDom((rec && rec.initial) ? rec.initial : null); }catch(_){ }
    // Etapa 4: mostrar Movimientos
    try{
      const mcard = document.getElementById('cashv2-movements-card');
      if (mcard){ mcard.style.display = 'block'; mcard.dataset.eventId = String(eventId); mcard.dataset.dayKey = dayKey; }
    }catch(_){ }
    try{ cashV2RenderMovementsUI(rec || { movements: [] }); }catch(_){ }
    // Etapa 5: mostrar Cierre
    try{
      const fcard = document.getElementById('cashv2-final-card');
      if (fcard){ fcard.style.display = 'block'; fcard.dataset.eventId = String(eventId); fcard.dataset.dayKey = dayKey; }
    }catch(_){ }
    try{ cashV2SetFinalEnabled(true); }catch(_){ }
    try{ cashV2ApplyFinalToDom((rec && rec.final) ? rec.final : null); }catch(_){ }
    try{ cashV2UpdateCloseSummary(rec); }catch(_){ }
    try{ cashV2UpdateCloseEligibility(rec); }catch(_){ }
    try{
      const ro = !!(blocked || locked || cashV2IsClosed(rec));
      cashV2ApplyReadOnlyUi(ro);
      try{ if (tab){ tab.classList.toggle('cashv2-readonly', ro); tab.classList.toggle('cashv2-closed', cashV2IsClosed(rec)); } }catch(_){ }
      try{ if (togEnabled && cashV2IsClosed(rec)) togEnabled.disabled = true; }catch(_){ }
      try{
        const ot = rec ? cashV2DeriveOpenTs(rec) : 0;
        if (elOpenAt) elOpenAt.textContent = ot ? new Date(ot).toLocaleString('es-NI') : '—';
      }catch(_){ try{ if (elOpenAt) elOpenAt.textContent = '—'; }catch(__){ } }
      try{ const fx = document.getElementById('cashv2-fx-card'); if (fx) fx.dataset.readonly = ro ? '1' : '0'; }catch(_){ }
      if (blocked && !cashV2IsClosed(rec)){
        cashV2SetCloseUiState({ canClose:false, reason:'Bloqueado: Efectivo OFF o evento inactivo' });
      }
      if (locked && !cashV2IsClosed(rec)){
        cashV2SetCloseUiState({ canClose:false, reason:'Día bloqueado (cierre del sistema)' });
      }
      if (!rec){
        cashV2SetCloseUiState({ canClose:false, reason:'Sin registro (solo lectura)' });
      }
    }catch(_){ }
    const baseStatus = (rec && rec.status) ? rec.status : 'OPEN';
    const statusForUi = cashV2IsClosed(rec) ? 'CLOSED' : ((locked || blocked) ? 'LOCKED' : baseStatus);
    const ui = cashV2StatusToUiPOS(statusForUi);
    if (statusTag){
      statusTag.textContent = ui.text;
      statusTag.classList.toggle('open', ui.cls === 'open');
      statusTag.classList.toggle('closed', ui.cls !== 'open');
    }
  }catch(err){
    try{
      const card = document.getElementById('cashv2-initial-card');
      if (card){ card.style.display = 'none'; card.dataset.eventId=''; card.dataset.dayKey=dayKey; }
      const mcard = document.getElementById('cashv2-movements-card');
      if (mcard){ mcard.style.display = 'none'; mcard.dataset.eventId=''; mcard.dataset.dayKey=dayKey; }
      const fcard = document.getElementById('cashv2-final-card');
      if (fcard){ fcard.style.display = 'none'; fcard.dataset.eventId=''; fcard.dataset.dayKey=dayKey; fcard.dataset.blocked='1'; fcard.dataset.locked='0'; }
    }catch(_){ }
    try{ cashV2SetInitialEnabled(false); }catch(_){ }
    try{ cashV2SetFinalEnabled(false); }catch(_){ }
    try{ cashV2SetLastRec(null); }catch(_){ }
    console.error('Efectivo v2: no se pudo load/ensure', err);
    try{
      if (statusTag){
        statusTag.textContent = 'Error';
        statusTag.classList.remove('open');
        statusTag.classList.add('closed');
      }
    }catch(_){ }
    try{
      if (elErr){
        const msg = (err && (err.message || err.name)) ? (err.message || err.name) : String(err);
        elErr.innerHTML = `<small><b>No se pudo cargar Efectivo.</b> ${escapeHtml(msg)}</small>`;
        elErr.style.display = 'block';
      }
    }catch(_){ }
  }
}

try{ window.A33_POS_BUILD = POS_BUILD; }catch(_){ }
try{ window.A33_POS_SW_CACHE = POS_SW_CACHE; }catch(_){ }
try{
  const el = document.getElementById('pos-build-id');
  if (el) el.textContent = 'POS Build: ' + POS_BUILD;
}catch(_){ }
try{
  const el = document.getElementById('pos-sw-cache-id');
  if (el){ el.textContent = 'SW Cache: ' + POS_SW_CACHE; el.title = POS_SW_CACHE; }
}catch(_){ }

// --- Etapa 2D: anti-duplicados en ventas (uid estable + dedupe)
const A33_PENDING_SALE_UID_KEY = 'a33_pos_pending_sale_uid_v1';
const A33_PENDING_SALE_FP_KEY = 'a33_pos_pending_sale_fp_v1';
const A33_PENDING_SALE_AT_KEY = 'a33_pos_pending_sale_at_v1';
const A33_PENDING_SALE_TTL_MS = 15 * 60 * 1000; // 15 min

function genSaleUidPOS(){
  return 'S-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2,10);
}

function saleFingerprintPOS(sale){
  try{
    if (!sale || typeof sale !== 'object') return '';
    const fp = {
      eventId: Number(sale.eventId || 0) || 0,
      date: safeYMD(sale.date || ''),
      productId: (sale.productId == null ? null : String(sale.productId)),
      productInternalId: (sale.productInternalId == null ? null : Number(sale.productInternalId)),
      extraId: (sale.extraId == null ? null : Number(sale.extraId)),
      productName: getSaleProductNameSnapshotPOS(sale),
      qty: Number(sale.qty || 0),
      unitPrice: Number(getSaleUnitPriceSnapshotPOS(sale)),
      discount: Number(sale.discount || 0),
      discountPerUnit: (sale.discountPerUnit == null ? null : Number(sale.discountPerUnit)),
      total: Number(sale.total || 0),
      payment: String(sale.payment || ''),
      bankId: (sale.bankId == null ? null : Number(sale.bankId)),
      courtesy: !!sale.courtesy,
      isReturn: !!sale.isReturn,
      customerId: (sale.customerId == null ? null : String(sale.customerId)),
      customerName: getSaleCustomerSnapshotNamePOS(sale),
      courtesyTo: String(sale.courtesyTo || ''),
      notes: String(sale.notes || '')
    };
    return JSON.stringify(fp);
  }catch(e){
    return '';
  }
}

function getOrCreatePendingSaleUidPOS(fingerprint){
  const fp = String(fingerprint || '');
  try{
    const now = Date.now();
    const existingUid = (localStorage.getItem(A33_PENDING_SALE_UID_KEY) || '').toString().trim();
    const existingFp = (localStorage.getItem(A33_PENDING_SALE_FP_KEY) || '').toString();
    const at = parseInt(localStorage.getItem(A33_PENDING_SALE_AT_KEY) || '0', 10);
    const fresh = (at && Number.isFinite(at) && (now - at) < A33_PENDING_SALE_TTL_MS);
    if (existingUid && fresh && existingFp === fp){
      return existingUid;
    }
  }catch(e){}

  const uid = genSaleUidPOS();
  try{
    localStorage.setItem(A33_PENDING_SALE_UID_KEY, uid);
    localStorage.setItem(A33_PENDING_SALE_FP_KEY, fp);
    localStorage.setItem(A33_PENDING_SALE_AT_KEY, String(Date.now()));
  }catch(e){}
  return uid;
}

function clearPendingSaleUidPOS(){
  try{ localStorage.removeItem(A33_PENDING_SALE_UID_KEY); }catch(e){}
  try{ localStorage.removeItem(A33_PENDING_SALE_FP_KEY); }catch(e){}
  try{ localStorage.removeItem(A33_PENDING_SALE_AT_KEY); }catch(e){}
}

// --- Nota: no tocar llaves históricas del módulo removido.
function cleanupHistoricalLocalStoragePOS(){
  return; // Anti-sótano: no borrar / no escribir histórico.
}


async function getSaleByUidPOS(uid){
  const key = String(uid || '').trim();
  if (!key) return null;
  try{
    if (!db) await openDB();
    return await new Promise((resolve, reject)=>{
      const tr = db.transaction(['sales'], 'readonly');
      const store = tr.objectStore('sales');
      let idx = null;
      try{ idx = store.index('by_uid'); }catch(_){ idx = null; }

      if (idx){
        const r = idx.get(key);
        r.onsuccess = ()=> resolve(r.result || null);
        r.onerror = ()=> reject(r.error);
      } else {
        const r = store.getAll();
        r.onsuccess = ()=>{
          const arr = r.result || [];
          resolve((arr || []).find(s => s && s.uid === key) || null);
        };
        r.onerror = ()=> reject(r.error);
      }
    });
  }catch(e){
    try{
      const all = await getAll('sales');
      return (all || []).find(s => s && s.uid === key) || null;
    }catch(_){
      return null;
    }
  }
}
// --- Resumen: modo de vista (por período vs todo)
let __A33_SUMMARY_VIEW_MODE = 'period'; // 'period' | 'all'

// --- Resumen: modo (en vivo vs archivo snapshot)
let __A33_SUMMARY_MODE = 'live'; // 'live' | 'archive'
let __A33_ACTIVE_ARCHIVE = null; // registro de summaryArchives activo

// --- Finanzas: conexión a finanzasDB para asientos automáticos
const FIN_DB_NAME = 'finanzasDB';
// Etapa 3 (Corte final): se APAGA el envío de ventas individuales a Finanzas.
// Finanzas se alimenta únicamente por cierres diarios consolidados (POS_DAILY_CLOSE).
const A33_FINANZAS_PER_SALE_ENABLED_DEFAULT = false;
let a33FinPerSaleWarned = false;
function isFinanzasPerSaleEnabled() {
  try {
    const v = (localStorage.getItem('a33_finanzas_per_sale') || '').toString().trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'on') return true;
    if (v === '0' || v === 'false' || v === 'off') return false;
  } catch (e) {}
  return A33_FINANZAS_PER_SALE_ENABLED_DEFAULT;
}
function warnFinanzasPerSaleDisabledOnce() {
  if (a33FinPerSaleWarned) return;
  a33FinPerSaleWarned = true;
  console.info('POS→Finanzas por venta individual está DESACTIVADO (Etapa 3). Usá cierres diarios.');
}

let finDb;
let finanzasBridgeWarned = false;
let finanzasBridgeBlockedWarned = false;
function notifyFinanzasBridge(msg, { force = false } = {}) {
  try {
    if (!force && finanzasBridgeWarned) return;
    finanzasBridgeWarned = true;
    if (typeof toast === 'function') toast(msg);
    else alert(msg);
  } catch (e) {
    console.warn('No se pudo notificar problema POS→Finanzas', e);
  }
}

function openDB(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};

  // Blindaje: estas constantes pueden no existir en builds hotfix.
  // Usar typeof evita ReferenceError cuando NO están definidas.
  const IDB_TIMEOUT_MS = (
    (typeof A33_PC_IDB_TIMEOUT_MS === 'number') && Number.isFinite(A33_PC_IDB_TIMEOUT_MS) && A33_PC_IDB_TIMEOUT_MS > 0
  ) ? A33_PC_IDB_TIMEOUT_MS : 12000;

  const TECH_CAUSES = (
    (typeof A33_PC_TECH_CAUSES === 'object') && A33_PC_TECH_CAUSES
  ) ? A33_PC_TECH_CAUSES : {
    IDB_TIMEOUT: 'IDB_TIMEOUT',
    IDB_BLOCKED: 'IDB_BLOCKED',
    IDB_ABORT: 'IDB_ABORT'
  };

  const timeoutMs = Number(o.timeoutMs || o.timeout || IDB_TIMEOUT_MS);

  // Reusar conexión abierta si existe
  if (db) return Promise.resolve(db);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let sawUpgradeNeeded = false;

    const mkErr = (code, msg, extra)=>{
      const e = new Error(msg || String(code || 'IDB_ERROR'));
      try{ e.code = code; }catch(_){ }
      try{ e.name = String(code || 'IDB_ERROR'); }catch(_){ }
      if (extra && typeof extra === 'object'){
        for (const k in extra){
          try{ e[k] = extra[k]; }catch(_){ }
        }
      }
      return e;
    };

    const logFail = (stage, err)=>{
      try{
        console.error('[POS][IDB] openDB fail', {
          stage,
          name: err && err.name,
          message: err && err.message,
          code: err && err.code,
          blocked: !!(err && err.blocked),
          upgradeNeeded: !!(err && err.upgradeNeeded)
        });
      }catch(_){ }
    };

    const finish = (ok, val)=>{
      if (settled){
        // Si resolvió tarde (después de timeout), cerrar para no filtrar conexiones.
        if (ok && val && typeof val.close === 'function'){
          try{ val.close(); }catch(_){ }
        }
        return;
      }
      settled = true;
      if (timer) clearTimeout(timer);
      if (ok) resolve(val);
      else reject(val);
    };

    const req = indexedDB.open(DB_NAME, DB_VER);

    timer = setTimeout(()=>{
      const e = mkErr(TECH_CAUSES.IDB_TIMEOUT, 'IDB open timeout', {
        phase: 'timeout',
        blocked: false,
        upgradeNeeded: sawUpgradeNeeded
      });
      logFail('timeout', e);
      finish(false, e);
    }, (Number.isFinite(timeoutMs) && timeoutMs > 0) ? timeoutMs : IDB_TIMEOUT_MS);

    // Etapa 6: si hay otra pestaña bloqueando un upgrade, NO colgar.
    req.onblocked = () => {
      const e = mkErr(TECH_CAUSES.IDB_BLOCKED, 'IDB blocked (another tab)', {
        phase: 'blocked',
        blocked: true,
        upgradeNeeded: sawUpgradeNeeded
      });
      logFail('blocked', e);
      finish(false, e);
    };

    req.onupgradeneeded = (e) => {
      sawUpgradeNeeded = true;
      const d = e.target.result;

      // Etapa 11D: eliminar cualquier store legacy exclusivo del módulo removido (legacy cleanup)
      try{
        const names = Array.from(d.objectStoreNames || []);
        for (const n of names){
          if (String(n).toLowerCase().startsWith(('pe'+'tty'))){
            try{ d.deleteObjectStore(n); }catch(_){ }
          }
        }
      }catch(_){ }
      if (!d.objectStoreNames.contains('products')) {
        const os = d.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        os.createIndex('by_name', 'name', { unique: false });
      }
      else {
        // productId es la identidad. El nombre puede repetirse entre productos distintos.
        try{
          const productsStore = e.target.transaction.objectStore('products');
          if (productsStore.indexNames.contains('by_name')) productsStore.deleteIndex('by_name');
          productsStore.createIndex('by_name', 'name', { unique:false });
        }catch(_){ }
      }
      if (!d.objectStoreNames.contains('events')) {
        const os2 = d.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
        os2.createIndex('by_name', 'name', { unique: true });
      }
      if (!d.objectStoreNames.contains('sales')) {
        const os3 = d.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
        os3.createIndex('by_date', 'date', { unique: false });
        os3.createIndex('by_event', 'eventId', { unique: false });
        try { os3.createIndex('by_uid', 'uid', { unique: true }); } catch {}
      } else {
        try { e.target.transaction.objectStore('sales').createIndex('by_date','date'); } catch {}
        try { e.target.transaction.objectStore('sales').createIndex('by_event','eventId'); } catch {}
        try { e.target.transaction.objectStore('sales').createIndex('by_uid','uid',{ unique:true }); } catch {}
      }
      if (!d.objectStoreNames.contains('inventory')) {
        const inv = d.createObjectStore('inventory', { keyPath: 'id', autoIncrement: true });
        inv.createIndex('by_event', 'eventId', { unique: false });
      } else {
        try { e.target.transaction.objectStore('inventory').createIndex('by_event','eventId'); } catch {}
      }

      // --- POS Inventario: Reempaque (modelo interno genérico, sin UI operativa todavía)
      if (!d.objectStoreNames.contains('reempaques')) {
        const rp = d.createObjectStore('reempaques', { keyPath: 'id' });
        try { rp.createIndex('by_event', 'eventId', { unique: false }); } catch {}
        try { rp.createIndex('by_createdAt', 'createdAt', { unique: false }); } catch {}
        try { rp.createIndex('by_event_createdAt', ['eventId','createdAt'], { unique: false }); } catch {}
        try { rp.createIndex('by_estado', 'estado', { unique: false }); } catch {}
      } else {
        try { e.target.transaction.objectStore('reempaques').createIndex('by_event','eventId', { unique: false }); } catch {}
        try { e.target.transaction.objectStore('reempaques').createIndex('by_createdAt','createdAt', { unique: false }); } catch {}
        try { e.target.transaction.objectStore('reempaques').createIndex('by_event_createdAt',['eventId','createdAt'], { unique: false }); } catch {}
        try { e.target.transaction.objectStore('reempaques').createIndex('by_estado','estado', { unique: false }); } catch {}
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'id' });
      }
// Catálogo de bancos (transferencias / tarjeta)
      if (!d.objectStoreNames.contains('banks')) {
        const b = d.createObjectStore('banks', { keyPath: 'id', autoIncrement: true });
        try { b.createIndex('by_name', 'name', { unique: false }); } catch {}
        try { b.createIndex('by_active', 'isActive', { unique: false }); } catch {}
      } else {
        try { e.target.transaction.objectStore('banks').createIndex('by_name', 'name'); } catch {}
        try { e.target.transaction.objectStore('banks').createIndex('by_active', 'isActive'); } catch {}
      }

      if (!d.objectStoreNames.contains('extras')) {
        const ex = d.createObjectStore('extras', { keyPath: 'id', autoIncrement: true });
        try { ex.createIndex('by_name', 'name', { unique: false }); } catch {}
        try { ex.createIndex('by_active', 'active', { unique: false }); } catch {}
      } else {
        try { e.target.transaction.objectStore('extras').createIndex('by_name', 'name', { unique: false }); } catch {}
        try { e.target.transaction.objectStore('extras').createIndex('by_active', 'active', { unique: false }); } catch {}
      }

      // --- POS: cierres diarios (snapshot) + candado por (evento,día)

      // --- POS: Efectivo v2 (storage aislado) — Etapa 1/9
      if (!d.objectStoreNames.contains('cashV2')) {
        const cv2 = d.createObjectStore('cashV2', { keyPath: 'key' });
        try { cv2.createIndex('by_event', 'eventId', { unique: false }); } catch {}
        try { cv2.createIndex('by_day', 'dayKey', { unique: false }); } catch {}
        try { cv2.createIndex('by_event_day', ['eventId','dayKey'], { unique: true }); } catch {}
      } else {
        try { e.target.transaction.objectStore('cashV2').createIndex('by_event', 'eventId', { unique: false }); } catch {}
        try { e.target.transaction.objectStore('cashV2').createIndex('by_day', 'dayKey', { unique: false }); } catch {}
        try { e.target.transaction.objectStore('cashV2').createIndex('by_event_day', ['eventId','dayKey'], { unique: true }); } catch {}
      }

      // --- POS: Efectivo v2 Histórico (header por día) — Etapa 1/5
      if (!d.objectStoreNames.contains('cashv2hist')) {
        const h = d.createObjectStore('cashv2hist', { keyPath: 'key' });
        try { h.createIndex('by_event', 'eventId', { unique: false }); } catch {}
        try { h.createIndex('by_day', 'dayKey', { unique: false }); } catch {}
        try { h.createIndex('by_event_day', ['eventId','dayKey'], { unique: true }); } catch {}
      } else {
        try { e.target.transaction.objectStore('cashv2hist').createIndex('by_event', 'eventId', { unique: false }); } catch {}
        try { e.target.transaction.objectStore('cashv2hist').createIndex('by_day', 'dayKey', { unique: false }); } catch {}
        try { e.target.transaction.objectStore('cashv2hist').createIndex('by_event_day', ['eventId','dayKey'], { unique: true }); } catch {}
      }

      // --- POS: Efectivo v2 Histórico (snapshots por versión) — Etapa 1/5
      if (!d.objectStoreNames.contains('cashv2snap')) {
        const s = d.createObjectStore('cashv2snap', { keyPath: 'key' });
        try { s.createIndex('by_event', 'eventId', { unique: false }); } catch {}
        try { s.createIndex('by_day', 'dayKey', { unique: false }); } catch {}
        try { s.createIndex('by_event_day', ['eventId','dayKey'], { unique: false }); } catch {}
        try { s.createIndex('by_event_day_v', ['eventId','dayKey','v'], { unique: true }); } catch {}
      } else {
        try { e.target.transaction.objectStore('cashv2snap').createIndex('by_event', 'eventId', { unique: false }); } catch {}
        try { e.target.transaction.objectStore('cashv2snap').createIndex('by_day', 'dayKey', { unique: false }); } catch {}
        try { e.target.transaction.objectStore('cashv2snap').createIndex('by_event_day', ['eventId','dayKey'], { unique: false }); } catch {}
        try { e.target.transaction.objectStore('cashv2snap').createIndex('by_event_day_v', ['eventId','dayKey','v'], { unique: true }); } catch {}
      }
      if (!d.objectStoreNames.contains('dayLocks')) {
        const l = d.createObjectStore('dayLocks', { keyPath: 'key' });
        try { l.createIndex('by_event', 'eventId', { unique: false }); } catch {}
        try { l.createIndex('by_date', 'dateKey', { unique: false }); } catch {}
        try { l.createIndex('by_event_date', ['eventId','dateKey'], { unique: true }); } catch {}
      }

      if (!d.objectStoreNames.contains('dailyClosures')) {
        const c = d.createObjectStore('dailyClosures', { keyPath: 'key' });
        try { c.createIndex('by_event', 'eventId', { unique: false }); } catch {}
        try { c.createIndex('by_event_date', ['eventId','dateKey'], { unique: false }); } catch {}
        try { c.createIndex('by_event_date_version', ['eventId','dateKey','version'], { unique: true }); } catch {}
        try { c.createIndex('by_createdAt', 'createdAt', { unique: false }); } catch {}
      }

      if (!d.objectStoreNames.contains('summaryArchives')) {
        const a = d.createObjectStore('summaryArchives', { keyPath: 'id' });
        try { a.createIndex('by_periodKey', 'periodKey', { unique: false }); } catch {}
        try { a.createIndex('by_createdAt', 'createdAt', { unique: false }); } catch {}
        try { a.createIndex('by_seq', 'seq', { unique: false }); } catch {}
      }

      if (!d.objectStoreNames.contains('posRemindersIndex')) {
        const r = d.createObjectStore('posRemindersIndex', { keyPath: 'idxId' });
        try { r.createIndex('by_event', 'eventId', { unique: false }); } catch {}
        try { r.createIndex('by_day', 'dayKey', { unique: false }); } catch {}
        try { r.createIndex('by_event_day', ['eventId','dayKey'], { unique: false }); } catch {}
        try { r.createIndex('by_updatedAt', 'updatedAt', { unique: false }); } catch {}
      } else {
        try { e.target.transaction.objectStore('posRemindersIndex').createIndex('by_event','eventId'); } catch {}
        try { e.target.transaction.objectStore('posRemindersIndex').createIndex('by_day','dayKey'); } catch {}
        try { e.target.transaction.objectStore('posRemindersIndex').createIndex('by_event_day',['eventId','dayKey']); } catch {}
        try { e.target.transaction.objectStore('posRemindersIndex').createIndex('by_updatedAt','updatedAt'); } catch {}
      }
    };

    req.onsuccess = () => {
      const conn = req.result;
      db = conn;

      // Etapa 6: cerrar en versionchange y dejar rastro visible
      try{
        db.onversionchange = () => {
          try{ db.close(); }catch(_){ }
          db = null;
          try{ window.__A33_POS_IDB_VERSIONCHANGE_AT = new Date().toISOString(); }catch(_){ }
          try{
            if (typeof pcDiagMark === 'function'){
              pcDiagMark('IDB', 'blocked', 'IndexedDB cambió de versión.', {
                causeCode: TECH_CAUSES.IDB_BLOCKED,
                techDetail: 'Versionchange detectado: se cerró la conexión. Cerrá otras pestañas y reintentá.',
                forensic: pcForensicNormalize({ extra: 'db.onversionchange' })
              });
            }
          }catch(_){ }
          try{ if (typeof showToast === 'function') showToast('La base se está actualizando. Cerrá otras pestañas y reintentá.', 'error', 6500); }catch(_){ }
        };
      }catch(_){ }

      finish(true, db);
    };

    req.onerror = () => {
      const e = req.error || mkErr(TECH_CAUSES.IDB_ABORT, 'IDB open error', {
        phase: 'error',
        blocked: false,
        upgradeNeeded: sawUpgradeNeeded
      });
      try{ if (!e.code) e.code = TECH_CAUSES.IDB_ABORT; }catch(_){ }
      try{ if (!e.phase) e.phase = 'error'; }catch(_){ }
      try{ if (typeof e.upgradeNeeded === 'undefined') e.upgradeNeeded = sawUpgradeNeeded; }catch(_){ }
      logFail('error', e);
      finish(false, e);
    };
  });
}


// --- Finanzas: helpers para abrir finanzasDB y crear/borrar asientos
function openFinanzasDB() {
  return new Promise((resolve, reject) => {
    if (finDb) return resolve(finDb);
    const req = indexedDB.open(FIN_DB_NAME);
    req.onblocked = () => {
      console.warn('Apertura de finanzasDB bloqueada (POS). Cierra otras pestañas con Suite A33/Finanzas abiertas.');
      if (!finanzasBridgeBlockedWarned) {
        finanzasBridgeBlockedWarned = true;
        notifyFinanzasBridge('⚠️ POS no puede conectar con Finanzas porque otra pestaña está bloqueando la base de datos. Cerrá otras pestañas de la Suite y reintentá.', { force: true });
      }
    };
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('accounts')) {
        const accStore = d.createObjectStore('accounts', { keyPath: 'code' });
        accStore.createIndex('type', 'type', { unique: false });
      }
      if (!d.objectStoreNames.contains('journalEntries')) {
        const entriesStore = d.createObjectStore('journalEntries', { keyPath: 'id', autoIncrement: true });
        entriesStore.createIndex('date', 'date', { unique: false });
        entriesStore.createIndex('tipoMovimiento', 'tipoMovimiento', { unique: false });
        entriesStore.createIndex('evento', 'evento', { unique: false });
        entriesStore.createIndex('origen', 'origen', { unique: false });
        entriesStore.createIndex('origenId', 'origenId', { unique: false });
      }
      if (!d.objectStoreNames.contains('journalLines')) {
        const linesStore = d.createObjectStore('journalLines', { keyPath: 'id', autoIncrement: true });
        linesStore.createIndex('entryId', 'entryId', { unique: false });
        linesStore.createIndex('accountCode', 'accountCode', { unique: false });
      }
    };
    req.onsuccess = (e) => {
      finDb = e.target.result;
      // Si Finanzas actualiza el esquema mientras POS está abierto, cerramos para no bloquear el upgrade
      finDb.onversionchange = () => {
        try { finDb.close(); } catch (e) {}
        finDb = null;
        console.warn('finanzasDB cambió de versión mientras POS estaba abierto; se cerró la conexión para permitir el upgrade.');
      };
      console.info(`POS conectado a finanzasDB (versión ${finDb.version})`);
      resolve(finDb);
    };
    req.onerror = () => {
      console.error('Error abriendo finanzasDB desde POS', req.error);
      notifyFinanzasBridge('⚠️ POS no pudo abrir Finanzas para asientos automáticos. Abrí el módulo Finanzas una vez, y si hay otra pestaña abierta, cerrala y reintentá.');
      reject(req.error);
    };
  });
}

async function ensureFinanzasDB() {
  try {
    await openFinanzasDB();
  } catch (e) {
    console.error('No se pudo abrir finanzasDB para asientos automáticos', e);
    notifyFinanzasBridge('⚠️ No se pudo conectar con Finanzas. Las ventas se guardaron, pero el asiento contable no se pudo generar. Revisá consola / versión de la BD y reintentá.');
    throw e;
  }
}



function posFinNormCode(code){
  return String(code ?? '').trim();
}

function posFinNormText(value){
  let out = String(value ?? '').toLowerCase().trim();
  try { out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch(_){ }
  return out.replace(/[^a-z0-9$]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function posFinGetAllAccountsPOS(){
  const dbFin = await openFinanzasDB();
  return await new Promise((resolve) => {
    try{
      const tx = dbFin.transaction(['accounts'], 'readonly');
      const store = tx.objectStore('accounts');
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
      tx.onerror = () => resolve([]);
    }catch(_){ resolve([]); }
  });
}

function posFinAccountCodePOS(acc){
  return posFinNormCode(acc && (acc.code ?? acc.codigo ?? acc.accountCode));
}

function posFinAccountNamePOS(acc){
  return String(acc && (acc.name || acc.nombre || acc.label || acc.descripcion) || '').trim();
}

function posFinAccountTypePOS(acc){
  return posFinNormText(acc && (acc.type || acc.tipo || acc.rootType || acc.nature || acc.naturaleza));
}

function posFinAccountByCodePOS(accounts, code){
  const wanted = posFinNormCode(code);
  return (accounts || []).find(acc => posFinAccountCodePOS(acc) === wanted) || null;
}

function posFinAccountHasChildrenPOS(accounts, code){
  const wanted = posFinNormCode(code);
  if (!wanted) return false;
  return (accounts || []).some(acc => {
    if (!acc) return false;
    const parent = posFinNormCode(acc.parentId ?? acc.parentCode ?? acc.parent ?? acc.padreCodigo ?? acc.parent_account_code);
    return parent === wanted;
  });
}

function posFinIsPostableAccountPOS(acc, accounts){
  if (!acc) return false;
  if (acc.isActive === false || acc.active === false || acc.estado === false) return false;
  const code = posFinAccountCodePOS(acc);
  if (!code) return false;
  if (acc.isRoot === true || acc.root === true) return false;
  if (acc.isPostable === false || acc.postable === false) return false;
  const mode = posFinNormText(acc.accountMode || acc.mode || acc.tipoCuenta || acc.claseCuenta);
  if (mode.includes('group') || mode.includes('agrup') || mode.includes('raiz') || mode.includes('root')) return false;
  if (acc.isGrouping === true || acc.grouping === true || acc.agrupadora === true) return false;
  if (posFinAccountHasChildrenPOS(accounts, code) && acc.isPostable !== true) return false;
  return true;
}

function posFinAccountCurrencyPOS(acc){
  const explicit = String(acc && (acc.currency || acc.moneda || acc.currencyCode || acc.currency_code) || '').trim().toUpperCase();
  if (explicit === 'USD' || explicit === 'US$') return 'USD';
  if (explicit === 'NIO' || explicit === 'C$' || explicit === 'CORDOBA' || explicit === 'CÓRDOBA') return 'NIO';
  const code = posFinAccountCodePOS(acc);
  const name = posFinNormText(posFinAccountNamePOS(acc));
  if (name.includes('usd') || name.includes('us$') || name.includes('dolar') || name.includes('dolares')) return 'USD';
  const n = Number(code);
  if (Number.isFinite(n)) {
    if (n >= 1201 && n <= 1999) {
      const rem = (n - 1201) % 10;
      if (rem === 1) return 'USD';
      if (rem === 0) return 'NIO';
    }
    if (String(code).endsWith('2')) return 'USD';
    if (String(code).endsWith('1')) return 'NIO';
  }
  return 'NIO';
}

function posFinMatchesWordsPOS(acc, words){
  const hay = `${posFinNormText(posFinAccountNamePOS(acc))} ${posFinNormText(posFinAccountCodePOS(acc))} ${posFinAccountTypePOS(acc)}`;
  return (words || []).every(w => hay.includes(posFinNormText(w)));
}

function posFinResolvePostableAccountPOS(accounts, opts){
  const cfg = opts || {};
  const currencyWanted = String(cfg.currency || '').trim().toUpperCase();
  const types = (cfg.types || []).map(posFinNormText).filter(Boolean);
  const codes = (cfg.codes || []).map(posFinNormCode).filter(Boolean);
  const wordSets = cfg.wordSets || [];
  const acceptable = (acc) => {
    if (!posFinIsPostableAccountPOS(acc, accounts)) return false;
    if (currencyWanted && posFinAccountCurrencyPOS(acc) !== currencyWanted) return false;
    if (types.length) {
      const t = posFinAccountTypePOS(acc);
      if (!types.some(type => t.includes(type))) return false;
    }
    return true;
  };

  for (const code of codes) {
    const acc = posFinAccountByCodePOS(accounts, code);
    if (acceptable(acc)) return posFinAccountCodePOS(acc);
  }

  for (const words of wordSets) {
    const acc = (accounts || []).find(a => acceptable(a) && posFinMatchesWordsPOS(a, Array.isArray(words) ? words : [words]));
    if (acc) return posFinAccountCodePOS(acc);
  }

  const fallback = (accounts || []).find(acceptable);
  if (fallback) return posFinAccountCodePOS(fallback);

  const label = cfg.label || 'cuenta contable';
  const cur = currencyWanted ? ` ${currencyWanted}` : '';
  throw new Error(`Falta ${label}${cur}: debe existir una cuenta activa, posteable y no agrupadora en Finanzas.`);
}

function posFinResolveCashAccountPOS(accounts, currency){
  const c = String(currency || 'NIO').toUpperCase() === 'USD' ? 'USD' : 'NIO';
  return posFinResolvePostableAccountPOS(accounts, {
    label: 'cuenta de Caja para POS', currency: c, types: ['activo'],
    codes: c === 'USD' ? ['1122','1112','1102','1110'] : ['1121','1111','1101','1110','1100'],
    wordSets: [['caja','eventos'], ['caja','general'], ['caja']]
  });
}

function posFinResolveBankAccountPOS(accounts, currency, payment){
  const c = String(currency || 'NIO').toUpperCase() === 'USD' ? 'USD' : 'NIO';
  const pay = normalizePaymentMethodPOS(payment || 'transferencia');
  return posFinResolvePostableAccountPOS(accounts, {
    label: pay === 'tarjeta' ? 'cuenta bancaria para tarjeta POS' : 'cuenta bancaria para transferencia POS',
    currency: c, types: ['activo'],
    codes: c === 'USD' ? ['1212','1222','1202','1200'] : ['1211','1221','1201','1200'],
    wordSets: pay === 'tarjeta'
      ? [['banco','tarjeta'], ['bancos','tarjeta'], ['banco']]
      : [['banco','transferencia'], ['bancos'], ['banco']]
  });
}

function posFinResolveCreditAccountPOS(accounts, currency){
  const c = String(currency || 'NIO').toUpperCase() === 'USD' ? 'USD' : 'NIO';
  return posFinResolvePostableAccountPOS(accounts, {
    label: 'cuenta por cobrar para crédito POS', currency: c, types: ['activo'],
    codes: c === 'USD' ? ['1312','1302','1300'] : ['1311','1301','1300'],
    wordSets: [['cuentas','cobrar'], ['clientes'], ['credito']]
  });
}

function posFinResolveIncomeAccountPOS(accounts){
  return posFinResolvePostableAccountPOS(accounts, {
    label: 'cuenta de ingresos operativos POS', types: ['ingreso'],
    codes: ['4211','4111','4101','4100'],
    wordSets: [['ventas','pos'], ['ventas','directas'], ['ingresos','operativos'], ['ventas']]
  });
}

function posFinProductKeyPOS(name){
  const n = posFinNormText(name);
  if (!n) return '';
  if (n.includes('vaso')) return 'vaso';
  if (n.includes('pulso')) return 'pulso';
  if (n.includes('media')) return 'media';
  if (n.includes('djeba')) return 'djeba';
  if (n.includes('litro')) return 'litro';
  if (n.includes('galon')) return 'galon';
  return '';
}

function posFinResolveProductAccountPOS(accounts, productName, side){
  const key = posFinProductKeyPOS(productName);
  const maps = {
    vaso: { cost: ['5131','5216','5101','5100'], inv: ['1441','1425','1501','1500'], wordsCost: [['vasos'], ['costo','ventas']], wordsInv: [['vasos'], ['inventario','producto']] },
    pulso: { cost: ['5215','5101','5100'], inv: ['1425','1501','1500'], wordsCost: [['costo','pulso'], ['costo','ventas']], wordsInv: [['pulso'], ['inventario','producto']] },
    media: { cost: ['5214','5101','5100'], inv: ['1424','1501','1500'], wordsCost: [['costo','media'], ['costo','ventas']], wordsInv: [['media'], ['inventario','producto']] },
    djeba: { cost: ['5213','5101','5100'], inv: ['1423','1501','1500'], wordsCost: [['costo','djeba'], ['costo','ventas']], wordsInv: [['djeba'], ['inventario','producto']] },
    litro: { cost: ['5212','5101','5100'], inv: ['1422','1501','1500'], wordsCost: [['costo','litro'], ['costo','ventas']], wordsInv: [['litro'], ['inventario','producto']] },
    galon: { cost: ['5211','5101','5100'], inv: ['1421','1501','1500'], wordsCost: [['costo','galon'], ['costo','ventas']], wordsInv: [['galon'], ['inventario','producto']] },
    generico: { cost: ['5101','5100'], inv: ['1501','1500'], wordsCost: [['costo','ventas']], wordsInv: [['inventario','producto']] }
  };
  // Productos dinámicos/temporales no deben caer por accidente en cuentas específicas de Galón.
  // Si el nombre no mapea a una presentación conocida, se usa cuenta genérica de costo/inventario.
  const m = maps[key] || maps.generico;
  if (side === 'inventory') {
    return posFinResolvePostableAccountPOS(accounts, { label: 'cuenta de inventario POS', types: ['activo'], codes: m.inv, wordSets: m.wordsInv });
  }
  return posFinResolvePostableAccountPOS(accounts, { label: 'cuenta de costo POS', types: ['costo'], codes: m.cost, wordSets: m.wordsCost });
}

function posFinResolveCourtesyExpenseAccountPOS(accounts){
  return posFinResolvePostableAccountPOS(accounts, {
    label: 'cuenta posteable para cortesías POS', types: ['gasto','costo','ingreso'],
    codes: ['6113','6123','6105','4312'],
    wordSets: [['degustaciones'], ['muestras'], ['cortesias'], ['cortesia'], ['descuentos']]
  });
}

function posFinLinePOS(accountCode, debe, haber){
  return { accountCode: posFinNormCode(accountCode), debe: round2(debe || 0), haber: round2(haber || 0) };
}

function posFinResolveCollectionAccountPOS(sale, accounts){
  const pay = normalizePaymentMethodPOS(sale && sale.payment || 'efectivo');
  const currency = String((sale && (sale.currency || sale.moneda || sale.paymentCurrency)) || 'NIO').toUpperCase() === 'USD' ? 'USD' : 'NIO';
  if (pay === 'efectivo') return posFinResolveCashAccountPOS(accounts, currency);
  if (pay === 'credito') return posFinResolveCreditAccountPOS(accounts, currency);
  return posFinResolveBankAccountPOS(accounts, currency, pay);
}

function posFinBuildSaleAutoLinesPOS(sale, accounts, amounts){
  const amount = round2(amounts && amounts.amount);
  const amountCost = round2(amounts && amounts.amountCost);
  const isCourtesy = !!(amounts && amounts.isCourtesy);
  const isReturn = !!(amounts && amounts.isReturn);
  const lines = [];
  if (isCourtesy) {
    if (amountCost > 0) {
      const courtesyCode = posFinResolveCourtesyExpenseAccountPOS(accounts);
      const inventoryCode = posFinResolveProductAccountPOS(accounts, getSaleProductNameSnapshotPOS(sale), 'inventory');
      if (!isReturn) {
        lines.push(posFinLinePOS(courtesyCode, amountCost, 0));
        lines.push(posFinLinePOS(inventoryCode, 0, amountCost));
      } else {
        lines.push(posFinLinePOS(inventoryCode, amountCost, 0));
        lines.push(posFinLinePOS(courtesyCode, 0, amountCost));
      }
    }
    return lines;
  }
  const collectionCode = amount > 0 ? posFinResolveCollectionAccountPOS(sale, accounts) : null;
  const incomeCode = amount > 0 ? posFinResolveIncomeAccountPOS(accounts) : null;
  const costCode = amountCost > 0 ? posFinResolveProductAccountPOS(accounts, getSaleProductNameSnapshotPOS(sale), 'cost') : null;
  const inventoryCode = amountCost > 0 ? posFinResolveProductAccountPOS(accounts, getSaleProductNameSnapshotPOS(sale), 'inventory') : null;
  if (!isReturn) {
    if (amount > 0) {
      lines.push(posFinLinePOS(collectionCode, amount, 0));
      lines.push(posFinLinePOS(incomeCode, 0, amount));
    }
    if (amountCost > 0) {
      lines.push(posFinLinePOS(costCode, amountCost, 0));
      lines.push(posFinLinePOS(inventoryCode, 0, amountCost));
    }
  } else {
    if (amount > 0) {
      lines.push(posFinLinePOS(incomeCode, amount, 0));
      lines.push(posFinLinePOS(collectionCode, 0, amount));
    }
    if (amountCost > 0) {
      lines.push(posFinLinePOS(inventoryCode, amountCost, 0));
      lines.push(posFinLinePOS(costCode, 0, amountCost));
    }
  }
  return lines;
}

function posFinValidateAutoLinesPOS(lines, accounts){
  const errors = [];
  (lines || []).forEach((line, idx) => {
    const code = posFinNormCode(line && line.accountCode);
    const acc = posFinAccountByCodePOS(accounts, code);
    if (!posFinIsPostableAccountPOS(acc, accounts)) {
      errors.push(`Línea ${idx + 1}: cuenta ${code || '(vacía)'} no existe o no es posteable.`);
    }
  });
  const debe = round2((lines || []).reduce((s, l) => s + round2(l && l.debe), 0));
  const haber = round2((lines || []).reduce((s, l) => s + round2(l && l.haber), 0));
  if (Math.abs(debe - haber) > 0.009) errors.push(`Debe/Haber no cuadra (Debe ${debe}, Haber ${haber}).`);
  return { ok: !errors.length, errors, debe, haber };
}

// Mapea forma de pago del POS a cuenta contable posteable sugerida (solo compatibilidad legacy).
function mapSaleToCuentaCobro(sale) {
  const pay = normalizePaymentMethodPOS(sale && sale.payment || 'efectivo');
  if (pay === 'efectivo') return '1121';
  if (pay === 'credito') return '1311';
  return '1211';
}

// Crea/actualiza asiento automático en Finanzas por una venta / devolución del POS
async function createJournalEntryForSalePOS(sale) {
  if (!isFinanzasPerSaleEnabled()) { warnFinanzasPerSaleDisabledOnce(); return null; }

  // Crea/actualiza el asiento automático en Finanzas para una venta del POS.
  // Reglas:
  // - Venta normal: ingreso + COGS
  // - Cortesía: SOLO costo (gasto por cortesía), nunca ingreso
  // - Devolución: asiento inverso
  // - Etapa Tablero 3/3: solo usa cuentas activas, posteables y no agrupadoras.

  if (!sale) return;

  const saleId = (sale.id != null) ? sale.id : (sale.createdAt != null ? sale.createdAt : null);
  if (saleId == null) {
    console.warn('Venta sin id/createdAt, no se genera asiento automático.');
    return;
  }

  try {
    await ensureFinanzasDB();

    const isCourtesy = !!sale.courtesy;
    const isReturn = !!sale.isReturn;
    const amount = round2(Math.abs(Number(sale.total || 0)));
    const qtyAbs = Math.abs(Number(sale.qty || 0)) || 0;

    let amountCost = 0;
    const lc = getSaleLineCostSnapshotPOS(sale);
    if (Number.isFinite(lc) && Math.abs(lc) > 0.000001) {
      amountCost = round2(Math.abs(lc));
    } else {
      const unitCostFromSale = getSaleCostUnitSnapshotPOS(sale);
      const unitCost = unitCostFromSale > 0 ? unitCostFromSale : getCostoUnitarioProducto(getSaleProductNameSnapshotPOS(sale));
      amountCost = round2((unitCost > 0 ? unitCost : 0) * qtyAbs);
    }

    if (!(amount > 0) && !(amountCost > 0)) return;

    const finAccounts = await posFinGetAllAccountsPOS();
    const autoLines = posFinBuildSaleAutoLinesPOS(sale, finAccounts, { amount, amountCost, isCourtesy, isReturn });
    const autoValidation = posFinValidateAutoLinesPOS(autoLines, finAccounts);
    if (!autoValidation.ok) {
      const msg = '⚠️ POS no generó asiento en Finanzas: ' + autoValidation.errors.join(' ');
      console.warn(msg);
      notifyFinanzasBridge(msg, { force: true });
      return;
    }

    const prodName = getSaleProductNameSnapshotPOS(sale).toString();
    const eventName = (sale.eventName || '').toString();
    const courtesyTo = (sale.courtesyTo || '').toString().trim();
    const customerName = getSaleCustomerSnapshotNamePOS(sale);

    const baseParts = [];
    if (prodName) baseParts.push(prodName);
    if (sale && sale.seqId) baseParts.push('N° ' + sale.seqId);
    if (customerName) baseParts.push('Cliente: ' + customerName);
    if (courtesyTo) baseParts.push('Para: ' + courtesyTo);
    const descripcionBase = baseParts.join(' | ');

    let descripcion = '';
    let tipoMovimiento = '';
    if (isCourtesy) {
      descripcion = 'Cortesía POS' + (descripcionBase ? (' - ' + descripcionBase) : '');
      tipoMovimiento = 'egreso';
    } else if (isReturn) {
      descripcion = 'Devolución POS - ' + (descripcionBase || '');
      tipoMovimiento = 'ajuste';
    } else {
      descripcion = 'Venta POS - ' + (descripcionBase || '');
      tipoMovimiento = 'ingreso';
    }

    const evento = eventName || 'General';
    const totalsDebe = autoValidation.debe;
    const totalsHaber = autoValidation.haber;

    let entryId = null;
    let existingEntry = null;

    await new Promise((resolve) => {
      const txRead = finDb.transaction(['journalEntries'], 'readonly');
      const store = txRead.objectStore('journalEntries');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        existingEntry = all.find(e => e && e.origen === 'POS' && e.origenId === saleId);
      };
      txRead.oncomplete = () => resolve();
      txRead.onerror = () => resolve();
    });

    await new Promise((resolve) => {
      const txWrite = finDb.transaction(['journalEntries'], 'readwrite');
      const storeWrite = txWrite.objectStore('journalEntries');

      const entryBase = {
        fecha: sale.date,
        date: sale.date,
        descripcion,
        tipoMovimiento,
        evento,
        origen: 'POS',
        origenId: saleId,
        totalDebe: totalsDebe,
        totalHaber: totalsHaber,
        source: 'pos_per_sale',
        isAutomatic: true,
        locked: true,
        validation: { postableAccounts: true, balanced: true }
      };

      if (existingEntry) {
        Object.assign(existingEntry, entryBase);
        const reqPut = storeWrite.put(existingEntry);
        reqPut.onsuccess = () => { entryId = existingEntry.id; };
      } else {
        const reqAdd = storeWrite.add(entryBase);
        reqAdd.onsuccess = (ev) => { entryId = ev.target.result; };
      }

      txWrite.oncomplete = () => {
        if (!entryId && existingEntry && existingEntry.id != null) entryId = existingEntry.id;
        resolve();
      };
      txWrite.onerror = () => {
        console.error('Error guardando asiento automático desde POS');
        resolve();
      };
    });

    if (!entryId) {
      console.error('No se pudo determinar entryId para asiento automático POS');
      return;
    }

    await new Promise((resolve) => {
      const txDel = finDb.transaction(['journalLines'], 'readwrite');
      const storeDel = txDel.objectStore('journalLines');
      const reqLines = storeDel.getAll();
      reqLines.onsuccess = () => {
        const lines = reqLines.result || [];
        lines
          .filter((l) => String(l.entryId) === String(entryId) || String(l.idEntry) === String(entryId))
          .forEach((l) => { try { storeDel.delete(l.id); } catch (err) {} });
      };
      txDel.oncomplete = () => resolve();
      txDel.onerror = () => resolve();
    });

    await new Promise((resolve) => {
      const txLines = finDb.transaction(['journalLines'], 'readwrite');
      const storeLines = txLines.objectStore('journalLines');
      autoLines.forEach((line) => {
        try { storeLines.add(Object.assign({ idEntry: entryId, entryId }, line)); }
        catch (err) { console.error('Error guardando línea contable POS', err); }
      });
      txLines.oncomplete = () => resolve();
      txLines.onerror = () => resolve();
    });
  } catch (err) {
    console.error('Error general creando/actualizando asiento automático desde POS', err);
    notifyFinanzasBridge('⚠️ POS no generó asiento en Finanzas: ' + (err && err.message ? err.message : 'validación contable fallida.'), { force: true });
  }
}

// Elimina asientos de Finanzas vinculados a una venta del POS (para Undo / eliminar)
async function deleteFinanzasEntriesForSalePOS(saleId) {
  // IMPORTANTE: esta función SIEMPRE debe devolver una Promise
  // para que el POS no se rompa al hacer: Promise.resolve(...).catch(...)
  if (saleId == null || saleId === '' || Number.isNaN(saleId)) return Promise.resolve();

  try {
    await ensureFinanzasDB();
  } catch (e) {
    // Si no se puede abrir finanzasDB, no bloqueamos el borrado de la venta
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    try {
      const txFin = finDb.transaction(['journalEntries', 'journalLines'], 'readwrite');
      const entriesStore = txFin.objectStore('journalEntries');
      const linesStore = txFin.objectStore('journalLines');

      const entriesReq = entriesStore.getAll();
      entriesReq.onsuccess = () => {
        const allEntries = entriesReq.result || [];
        const targets = allEntries.filter(e => e && e.origen === 'POS' && e.origenId === saleId);
        if (!targets.length) {
          // No hay nada que borrar, dejamos que la tx se complete sola
          return;
        }

        const linesReq = linesStore.getAll();
        linesReq.onsuccess = () => {
          const allLines = linesReq.result || [];
          targets.forEach(entry => {
            const relatedLines = allLines.filter(l => String(l.entryId) === String(entry.id) || String(l.idEntry) === String(entry.id));
            relatedLines.forEach(l => {
              try { linesStore.delete(l.id); } catch (err) {
                console.error('Error borrando línea contable POS', err);
              }
            });
            try { entriesStore.delete(entry.id); } catch (err) {
              console.error('Error borrando asiento automático POS', err);
            }
          });
        };
        linesReq.onerror = (e) => {
          console.error('Error leyendo líneas de diario para borrar asientos POS', e.target.error);
        };
      };
      entriesReq.onerror = (e) => {
        console.error('Error leyendo asientos para borrar por venta POS', e.target.error);
      };

      txFin.oncomplete = () => resolve();
      txFin.onerror = (e) => {
        console.error('Error en transacción de borrado de asientos POS', e.target.error);
        reject(e.target.error);
      };
    } catch (err) {
      console.error('Error general al eliminar asientos POS', err);
      resolve();
    }
  });
}


// ------------------------------
// POS → Finanzas: sección (movimientos manuales)
// ------------------------------
function tx(name, mode='readonly'){ return db.transaction(name, mode).objectStore(name); }
function getAll(name){ return new Promise((res,rej)=>{ const r=tx(name).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
function getOne(name, key){ return new Promise((res,rej)=>{ try{ const r=tx(name).get(key); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); }catch(err){ rej(err); } }); }
function put(name, val){ return new Promise((res,rej)=>{ const r=tx(name,'readwrite').put(val); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function clearStore(name){
  return new Promise((res,rej)=>{
    try{
      const t = db.transaction([name], 'readwrite');
      const st = t.objectStore(name);
      try{ st.clear(); }catch(err){ rej(err); return; }
      t.oncomplete = ()=>res(true);
      t.onerror = ()=>rej(t.error);
      t.onabort = ()=>rej(t.error || new Error('Transacción abortada limpiando ' + name));
    }catch(err){ rej(err); }
  });
}


// ------------------------------------------------------------
// POS Inventario — Reempaque (Etapa 1/5)
// Modelo interno genérico. No vende, no cobra, no toca caja y no mueve stock.
// ------------------------------------------------------------
const REEMPAQUE_STORE_POS = 'reempaques';
const REEMPAQUE_VISIBLE_NAME_POS = 'Reempaque';
const REEMPAQUE_STATUS_VALID_POS = 'VALIDO';

function reempaqueNowISOPOS(){
  try{ return new Date().toISOString(); }catch(_){ return String(Date.now()); }
}

function reempaqueBuildIdPOS(){
  const ts = Date.now ? Date.now() : (new Date()).getTime();
  const rnd = Math.random().toString(36).slice(2, 10);
  return `rpq_${ts}_${rnd}`;
}

function reempaqueNumPOS(value, fallback=0){
  if (value === null || typeof value === 'undefined' || value === '') return fallback;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function reempaquePositivePOS(value){
  const n = reempaqueNumPOS(value, 0);
  return n > 0 ? n : 0;
}

function reempaqueMoneyPOS(value){
  const n = reempaqueNumPOS(value, 0);
  return n > 0 ? round2(n) : 0;
}

function reempaqueRound4POS(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function reempaqueProductNameFromRefPOS(ref){
  if (ref && typeof ref === 'object'){
    return String(ref.name || ref.nombre || ref.productName || ref.label || ref.codigo || '').trim();
  }
  if (ref === null || typeof ref === 'undefined') return '';
  return String(ref).trim();
}

function reempaqueProductIdFromRefPOS(ref){
  if (ref && typeof ref === 'object'){
    const id = ref.id ?? ref.productId ?? ref.productoId ?? ref.codigo ?? ref.code ?? null;
    return (id === null || typeof id === 'undefined' || id === '') ? null : id;
  }
  if (typeof ref === 'number' && Number.isFinite(ref)) return ref;
  if (typeof ref === 'string' && /^\d+$/.test(ref.trim())) return Number(ref.trim());
  return null;
}

function reempaqueParseCapacityMlFromTextPOS(text){
  const raw = String(text || '').trim();
  if (!raw) return 0;
  const nrm = (typeof normName === 'function') ? normName(raw) : raw.toLowerCase();

  let m = raw.match(/(\d+(?:[\.,]\d+)?)\s*(?:ml|m\.l\.|mililitros?)/i);
  if (m){
    const v = reempaqueNumPOS(m[1], 0);
    return v > 0 ? v : 0;
  }

  m = raw.match(/(\d+(?:[\.,]\d+)?)\s*(?:l|lt|lts|litro|litros)\b/i);
  if (m){
    const v = reempaqueNumPOS(m[1], 0);
    return v > 0 ? v * 1000 : 0;
  }

  // Fallbacks por presentaciones base existentes, sin limitar Reempaque a ellas.
  if (nrm.includes('pulso')) return 250;
  if (nrm.includes('media')) return 375;
  if (nrm.includes('djeba')) return 750;
  if (nrm.includes('litro')) return 1000;
  if (nrm.includes('galon') || nrm.includes('galón')) return 3720;
  return 0;
}

function reempaqueCapacityMlFromProductPOS(productLike){
  const p = (productLike && typeof productLike === 'object') ? productLike : { name: reempaqueProductNameFromRefPOS(productLike) };
  const candidates = [
    p.capacityMl, p.capacidadMl, p.volumeMl, p.volumenMl, p.contenidoMl,
    p.ml, p.mililitros, p.capacity, p.capacidad, p.volume, p.volumen
  ];
  for (const c of candidates){
    const n = reempaqueNumPOS(c, 0);
    if (n > 0) return n;
  }
  return reempaqueParseCapacityMlFromTextPOS(p.name || p.nombre || p.productName || p.label || '');
}

function reempaqueComputeSuggestedQtyByVolumePOS(cantidadOrigen, capacidadOrigenMl, capacidadDestinoMl){
  const qty = reempaquePositivePOS(cantidadOrigen);
  const srcMl = reempaquePositivePOS(capacidadOrigenMl);
  const dstMl = reempaquePositivePOS(capacidadDestinoMl);
  if (!(qty > 0 && srcMl > 0 && dstMl > 0)) return null;
  return reempaqueRound4POS((qty * srcMl) / dstMl);
}


function reempaqueTotalVolumePOS(cantidad, mlPorUnidad){
  const qty = reempaquePositivePOS(cantidad);
  const ml = reempaquePositivePOS(mlPorUnidad);
  return (qty > 0 && ml > 0) ? reempaqueRound4POS(qty * ml) : 0;
}

function reempaqueCostPerMlPOS(costoTotalOrigen, volumenTotalOrigenMl){
  const cost = reempaqueMoneyPOS(costoTotalOrigen);
  const volume = reempaquePositivePOS(volumenTotalOrigenMl);
  return (cost > 0 && volume > 0) ? reempaqueRound4POS(cost / volume) : 0;
}

function reempaqueArrayFromInputPOS(input){
  const src = input || {};
  const candidates = [src.destinos, src.destinations, src.listaDestinos, src.targets, src.targetProducts, src.productosDestino];
  for (const c of candidates){
    if (Array.isArray(c)) return c;
  }
  return [];
}

function reempaqueHasMultipleDestinationsInputPOS(input){
  return reempaqueArrayFromInputPOS(input).length > 0;
}

function reempaqueIsMultipleRecordPOS(record){
  const r = record || {};
  return !!(
    r.modo === 'MULTIPLE' ||
    r.tipoReempaque === 'MULTIPLE' ||
    r.isMultiReempaque ||
    r.reempaqueMultiple ||
    (Array.isArray(r.destinos) && r.destinos.length > 0)
  );
}

function reempaqueRawHasNegativeNumberPOS(obj){
  if (!obj || typeof obj !== 'object') return false;
  const seen = new Set();
  const walk = (value) => {
    if (value === null || typeof value === 'undefined' || value === '') return false;
    if (typeof value === 'number') return Number.isFinite(value) && value < 0;
    if (typeof value === 'string'){
      const t = value.trim();
      if (!t || /[^0-9,\.\-]/.test(t)) return false;
      const n = Number(t.replace(',', '.'));
      return Number.isFinite(n) && n < 0;
    }
    if (Array.isArray(value)) return value.some(walk);
    if (typeof value === 'object'){
      if (seen.has(value)) return false;
      seen.add(value);
      return Object.keys(value).some(k => walk(value[k]));
    }
    return false;
  };
  return walk(obj);
}

function reempaqueDestinationRefFromInputPOS(raw){
  const r = raw || {};
  return r.productoDestino ?? r.destino ?? r.targetProduct ?? r.productTarget ?? r.producto ?? r.product ?? r.productId ?? r.targetProductId ?? r.productoDestinoId ?? null;
}

function reempaqueDestinationQtyFromInputPOS(raw){
  const r = raw || {};
  return reempaquePositivePOS(r.cantidadCreada ?? r.cantidadCreadaDestino ?? r.cantidadDestino ?? r.qtyDestino ?? r.targetQty ?? r.quantity ?? r.qty ?? r.cantidad ?? 0);
}

function reempaqueDestinationMlFromInputPOS(raw, normalizedProduct){
  const r = raw || {};
  const manual = reempaquePositivePOS(r.mlPorUnidad ?? r.mlUnidad ?? r.capacidadDestinoMl ?? r.capacidadMl ?? r.volumeMl ?? r.volumenMl ?? r.contenidoMl ?? 0);
  if (manual > 0) return manual;
  return reempaquePositivePOS((normalizedProduct && normalizedProduct.capacityMl) || 0);
}

function reempaqueBuildMultipleDestinationsPOS(rawDestinos, products, costoPorMl){
  const out = [];
  const list = Array.isArray(rawDestinos) ? rawDestinos : [];
  for (let i = 0; i < list.length; i++){
    const raw = list[i] || {};
    const normalized = reempaqueNormalizeProductRefPOS(reempaqueDestinationRefFromInputPOS(raw), products);
    const cantidadCreada = reempaqueDestinationQtyFromInputPOS(raw);
    const mlPorUnidad = reempaqueDestinationMlFromInputPOS(raw, normalized);
    const volumenManual = reempaquePositivePOS(raw.volumenTotalDestinoMl ?? raw.volumenDestinoMl ?? raw.totalMl ?? raw.volumeTotalMl ?? 0);
    const volumenTotalDestinoMl = volumenManual > 0 ? volumenManual : reempaqueTotalVolumePOS(cantidadCreada, mlPorUnidad);
    const costoLiquidoTotalManual = reempaqueMoneyPOS(raw.costoLiquidoTotal ?? raw.costoLiquidoAsignado ?? raw.liquidCostTotal ?? raw.liquidTotalCost ?? 0);
    const costoLiquidoTotal = (costoPorMl > 0 && volumenTotalDestinoMl > 0)
      ? round2(volumenTotalDestinoMl * costoPorMl)
      : costoLiquidoTotalManual;
    const costoLiquidoUnitario = (cantidadCreada > 0 && costoLiquidoTotal > 0)
      ? round2(costoLiquidoTotal / cantidadCreada)
      : reempaqueMoneyPOS(raw.costoLiquidoUnitario ?? raw.liquidUnitCost ?? raw.costoUnitarioLiquido ?? 0);
    const costoAdicionalUnitario = reempaqueMoneyPOS(raw.costoAdicionalUnitario ?? raw.costoEmpaqueUnitario ?? raw.extraUnitCost ?? raw.additionalUnitCost ?? 0);
    const costoAdicionalTotalManual = reempaqueMoneyPOS(raw.costoAdicionalTotal ?? raw.costoEmpaqueTotal ?? raw.extraCostTotal ?? raw.additionalCostTotal ?? 0);
    const costoAdicionalTotal = costoAdicionalTotalManual > 0
      ? costoAdicionalTotalManual
      : ((cantidadCreada > 0 && costoAdicionalUnitario > 0) ? round2(cantidadCreada * costoAdicionalUnitario) : 0);
    const costoTotalManual = reempaqueMoneyPOS(raw.costoTotalAsignado ?? raw.costoAsignado ?? raw.costTotalAssigned ?? raw.totalCost ?? 0);
    const costoTotalAsignado = (costoLiquidoTotal > 0 || costoAdicionalTotal > 0)
      ? round2(costoLiquidoTotal + costoAdicionalTotal)
      : costoTotalManual;
    const costoUnitarioCalculado = (cantidadCreada > 0 && costoTotalAsignado > 0)
      ? round2(costoTotalAsignado / cantidadCreada)
      : reempaqueMoneyPOS(raw.costoUnitarioCalculado ?? raw.costoUnitarioDestino ?? raw.targetUnitCost ?? raw.unitCost ?? 0);
    const tipoDestinoRaw = String(raw.tipoDestino ?? raw.destinoTipo ?? (raw.productoNuevoCreado ? 'NUEVO' : (raw.destinoNuevo || raw.productoNuevoDestino ? 'NUEVO' : 'EXISTENTE'))).toUpperCase();
    const tipoDestino = (tipoDestinoRaw === 'NUEVO' || tipoDestinoRaw === 'NUEVO_EXISTENTE') ? tipoDestinoRaw : 'EXISTENTE';
    const precioVentaDestino = reempaqueMoneyPOS(raw.precioVentaDestino ?? raw.precioDestino ?? (normalized.base && normalized.base.price));
    out.push({
      index: i,
      productoDestino: normalized.name,
      productoDestinoId: normalized.id,
      productoDestinoNombre: normalized.name,
      targetProduct: { id: normalized.id, name: normalized.name, capacityMl: mlPorUnidad > 0 ? mlPorUnidad : normalized.capacityMl },
      targetProductId: normalized.id,
      targetProductName: normalized.name,
      tipoDestino,
      destinoTipo: tipoDestino,
      destinoNuevo: !!(raw.destinoNuevo || raw.productoNuevoDestino || tipoDestino === 'NUEVO' || tipoDestino === 'NUEVO_EXISTENTE'),
      productoNuevoDestino: !!(raw.destinoNuevo || raw.productoNuevoDestino || tipoDestino === 'NUEVO' || tipoDestino === 'NUEVO_EXISTENTE'),
      productoNuevoCreado: !!(raw.productoNuevoCreado || tipoDestino === 'NUEVO'),
      precioVentaDestino,
      cantidadCreada,
      cantidadCreadaDestino: cantidadCreada,
      cantidadDestino: cantidadCreada,
      mlPorUnidad,
      capacidadDestinoMl: mlPorUnidad > 0 ? mlPorUnidad : null,
      volumenTotalDestinoMl,
      costoLiquidoUnitario,
      costoUnitarioLiquido: costoLiquidoUnitario,
      costoLiquidoTotal,
      costoLiquidoAsignado: costoLiquidoTotal,
      costoAdicionalUnitario,
      costoEmpaqueUnitario: costoAdicionalUnitario,
      costoAdicionalTotal,
      costoEmpaqueTotal: costoAdicionalTotal,
      costoUnitarioCalculado,
      costoUnitarioDestino: costoUnitarioCalculado,
      costoTotalAsignado,
      raw: raw || null
    });
  }
  return out;
}

async function reempaquePrepareMultiplePayloadPOS(input={}){
  if (!db) await openDB();
  const products = await getAll('products').catch(()=>[]);
  const now = reempaqueNowISOPOS();
  const evInfo = await reempaqueResolveEventInfoPOS(input.eventId ?? input.eventoId ?? input.eventRef ?? null);
  const src = reempaqueNormalizeProductRefPOS(
    input.productoOrigen ?? input.origen ?? input.sourceProduct ?? input.productSource ?? input.sourceProductId ?? null,
    products
  );
  const cantidadOrigen = reempaquePositivePOS(input.cantidadOrigen ?? input.sourceQty ?? input.qtyOrigen ?? input.originQty ?? 0);
  const capacidadOrigenMl = reempaquePositivePOS(input.capacidadOrigenMl ?? input.volumenMlOrigenUnidad ?? input.mlPorUnidadOrigen ?? src.capacityMl ?? 0);
  const volumenTotalManual = reempaquePositivePOS(input.volumenTotalOrigenMl ?? input.volumenTotalOrigen ?? input.sourceTotalVolumeMl ?? input.totalSourceMl ?? 0);
  const volumenTotalOrigenMl = volumenTotalManual > 0 ? volumenTotalManual : reempaqueTotalVolumePOS(cantidadOrigen, capacidadOrigenMl);
  const costoUnitarioOrigen = reempaqueMoneyPOS(input.costoUnitarioOrigen ?? input.costoOrigenUnitario ?? input.sourceUnitCost ?? input.unitCostOrigin ?? 0);
  const costoOrigenTotalManual = reempaqueMoneyPOS(input.costoOrigenTotal ?? input.sourceCostTotal ?? input.costoTotalOrigen ?? 0);
  const costoTotalOrigen = costoOrigenTotalManual > 0
    ? costoOrigenTotalManual
    : ((costoUnitarioOrigen > 0 && cantidadOrigen > 0) ? round2(costoUnitarioOrigen * cantidadOrigen) : 0);
  const costoPorMl = reempaqueCostPerMlPOS(costoTotalOrigen, volumenTotalOrigenMl);
  const destinos = reempaqueBuildMultipleDestinationsPOS(reempaqueArrayFromInputPOS(input), products, costoPorMl);
  const volumenTotalDestinoMl = reempaqueRound4POS(destinos.reduce((a,d)=> a + reempaquePositivePOS(d && d.volumenTotalDestinoMl), 0));
  const costoLiquidoDistribuido = round2(destinos.reduce((a,d)=> a + reempaqueMoneyPOS(d && (d.costoLiquidoTotal ?? d.costoLiquidoAsignado)), 0));
  const costoAdicionalTotal = round2(destinos.reduce((a,d)=> a + reempaqueMoneyPOS(d && d.costoAdicionalTotal), 0));
  const costoTotalDistribuido = round2(destinos.reduce((a,d)=> a + reempaqueMoneyPOS(d && d.costoTotalAsignado), 0));
  const mlSobranteMerma = reempaqueRound4POS(Math.max(0, volumenTotalOrigenMl - volumenTotalDestinoMl));
  const costoSobranteMerma = (costoPorMl > 0 && mlSobranteMerma > 0) ? round2(mlSobranteMerma * costoPorMl) : 0;
  const destinoResumen = destinos.map(d => `${d.productoDestinoNombre || d.productoDestino || 'Destino'} x ${reempaqueFmtQtyPOS(d.cantidadCreada)}`).join(' + ');

  return {
    id: String(input.id || reempaqueBuildIdPOS()),
    tipo: 'REEMPAQUE',
    nombreVisible: REEMPAQUE_VISIBLE_NAME_POS,
    modo: 'MULTIPLE',
    tipoReempaque: 'MULTIPLE',
    isMultiReempaque: true,
    reempaqueMultiple: true,
    fechaHora: String(input.fechaHora || input.date || now),
    date: String(input.date || input.fechaHora || now),
    timestamp: reempaqueNumPOS(input.timestamp, Date.now ? Date.now() : (new Date()).getTime()),
    eventId: evInfo.eventId,
    eventoId: evInfo.eventoId,
    eventName: evInfo.eventName,
    nombreEvento: evInfo.nombreEvento,
    eventCode: evInfo.eventCode,
    eventoCodigo: evInfo.eventoCodigo,

    productoOrigen: src.name,
    sourceProduct: { id: src.id, name: src.name, capacityMl: capacidadOrigenMl > 0 ? capacidadOrigenMl : src.capacityMl },
    sourceProductId: src.id,
    sourceProductName: src.name,
    productoOrigenId: src.id,
    productoOrigenNombre: src.name,
    cantidadOrigen,
    capacidadOrigenMl: capacidadOrigenMl > 0 ? capacidadOrigenMl : null,
    capacidadVolumenOrigen: capacidadOrigenMl > 0 ? capacidadOrigenMl : null,
    volumenTotalOrigenMl,
    costoUnitarioOrigen,
    costoTotalOrigen,
    costoOrigenTotal: costoTotalOrigen,
    costoPorMl,

    destinos,
    listaDestinos: destinos,
    destinoResumen,
    cantidadDestinos: destinos.length,
    volumenTotalDestinoMl,
    costoLiquidoDistribuido,
    costoAdicionalTotal,
    costoAdicionalDestinos: costoAdicionalTotal,
    costoTotalDistribuido,
    costoTotalFinalDestinos: costoTotalDistribuido,
    costoTotalReempaque: costoTotalDistribuido,
    mlSobranteMerma,
    costoSobranteMerma,
    merma: { ml: mlSobranteMerma, costo: costoSobranteMerma },
    sobranteMerma: { ml: mlSobranteMerma, costo: costoSobranteMerma },
    afectaVentas: false,
    afectaCaja: false,
    afectaEfectivo: false,
    afectaDiarioIngreso: false,
    noVenta: true,
    noCaja: true,
    nota: String(input.nota || input.note || '').trim(),
    estado: String(input.estado || REEMPAQUE_STATUS_VALID_POS),
    estadoValido: true,
    valid: true,
    createdAt: String(input.createdAt || now),
    updatedAt: String(input.updatedAt || now)
  };
}

function reempaqueValidateMultipleRecordPOS(record){
  const errors = [];
  const warnings = [];
  const r = record || {};
  const srcName = String(r.sourceProductName || r.productoOrigenNombre || r.productoOrigen || (r.sourceProduct && r.sourceProduct.name) || '').trim();
  const srcId = r.sourceProductId ?? r.productoOrigenId ?? (r.sourceProduct && r.sourceProduct.id);
  const qtyOrigen = reempaquePositivePOS(r.cantidadOrigen ?? r.sourceQty ?? r.qtyOrigen);
  const volumenOrigen = reempaquePositivePOS(r.volumenTotalOrigenMl ?? r.volumenTotalOrigen ?? 0);
  const costoOrigen = reempaqueMoneyPOS(r.costoTotalOrigen ?? r.costoOrigenTotal ?? r.sourceCostTotal ?? 0);
  const costoPorMl = reempaqueCostPerMlPOS(costoOrigen, volumenOrigen) || reempaquePositivePOS(r.costoPorMl);
  const destinos = Array.isArray(r.destinos) ? r.destinos : reempaqueArrayFromInputPOS(r);

  if (!srcName && (srcId === null || typeof srcId === 'undefined' || srcId === '')) errors.push('producto_origen_requerido');
  if (!(qtyOrigen > 0)) errors.push('cantidad_origen_mayor_cero');
  if (!(volumenOrigen > 0)) errors.push('volumen_total_origen_mayor_cero');
  if (!Array.isArray(destinos) || destinos.length < 1) errors.push('destinos_requeridos');
  if (reempaqueRawHasNegativeNumberPOS(r)) errors.push('valores_negativos_no_permitidos');

  let volumenDestinos = 0;
  let costoLiquidoDistribuido = 0;
  let costoFinalDistribuido = 0;
  for (let i = 0; i < (destinos || []).length; i++){
    const d = destinos[i] || {};
    const dName = String(d.targetProductName || d.productoDestinoNombre || d.productoDestino || (d.targetProduct && d.targetProduct.name) || '').trim();
    const dId = d.targetProductId ?? d.productoDestinoId ?? (d.targetProduct && d.targetProduct.id);
    const qty = reempaquePositivePOS(d.cantidadCreada ?? d.cantidadCreadaDestino ?? d.cantidadDestino ?? d.targetQty ?? d.qty ?? d.cantidad);
    const ml = reempaquePositivePOS(d.mlPorUnidad ?? d.capacidadDestinoMl ?? (d.targetProduct && d.targetProduct.capacityMl));
    const vol = reempaquePositivePOS(d.volumenTotalDestinoMl ?? reempaqueTotalVolumePOS(qty, ml));
    const extraUnit = reempaqueMoneyPOS(d.costoAdicionalUnitario ?? d.costoEmpaqueUnitario ?? d.extraUnitCost ?? d.additionalUnitCost ?? 0);
    const extraTotal = reempaqueMoneyPOS(d.costoAdicionalTotal ?? d.costoEmpaqueTotal ?? d.extraCostTotal ?? d.additionalCostTotal ?? ((extraUnit > 0 && qty > 0) ? extraUnit * qty : 0));
    const finalCost = reempaqueMoneyPOS(d.costoTotalAsignado ?? d.costoAsignado ?? ((d.costoUnitarioCalculado ?? d.costoUnitarioDestino ?? d.targetUnitCost) && qty > 0 ? (d.costoUnitarioCalculado ?? d.costoUnitarioDestino ?? d.targetUnitCost) * qty : 0));
    const liquidCost = reempaqueMoneyPOS(
      d.costoLiquidoTotal ??
      d.costoLiquidoAsignado ??
      d.liquidCostTotal ??
      d.liquidTotalCost ??
      ((costoPorMl > 0 && vol > 0) ? vol * costoPorMl : (finalCost > 0 ? Math.max(0, finalCost - extraTotal) : 0))
    );
    if (!dName && (dId === null || typeof dId === 'undefined' || dId === '')) errors.push(`destino_${i+1}_producto_requerido`);
    if (!(qty > 0)) errors.push(`destino_${i+1}_cantidad_mayor_cero`);
    if (!(ml > 0)) errors.push(`destino_${i+1}_ml_por_unidad_mayor_cero`);
    if (!(vol > 0)) errors.push(`destino_${i+1}_volumen_mayor_cero`);
    volumenDestinos += vol;
    costoLiquidoDistribuido += liquidCost;
    costoFinalDistribuido += finalCost > 0 ? finalCost : round2(liquidCost + extraTotal);
  }

  volumenDestinos = reempaqueRound4POS(volumenDestinos);
  costoLiquidoDistribuido = round2(costoLiquidoDistribuido);
  costoFinalDistribuido = round2(costoFinalDistribuido);
  if (volumenOrigen > 0 && volumenDestinos > (volumenOrigen + 0.0001)) errors.push('volumen_destino_excede_origen');
  // Solo el costo líquido distribuido se compara contra el origen.
  // Los costos adicionales (botella, tapa, empaque, etc.) forman parte del costo final del destino
  // y pueden hacer que el costo final total supere el costo del origen sin bloquear el Reempaque.
  if (costoOrigen > 0 && costoLiquidoDistribuido > (costoOrigen + 0.05)) errors.push('costo_distribuido_excede_origen');
  if (!(costoOrigen > 0)) warnings.push('origen_sin_costo_total');
  if (!(costoPorMl > 0)) warnings.push('costo_por_ml_no_calculado');

  return { ok: errors.length === 0, errors, warnings };
}

function reempaqueNormalizeProductRefPOS(ref, products){
  const list = Array.isArray(products) ? products : [];
  let found = null;
  const refId = reempaqueProductIdFromRefPOS(ref);
  const refName = reempaqueProductNameFromRefPOS(ref);

  if (refId !== null){
    found = list.find(p => p && String(p.id) === String(refId)) || null;
  }
  if (!found && refName){
    const refKey = (typeof normName === 'function') ? normName(refName) : refName.toLowerCase().trim();
    found = list.find(p => p && (((typeof normName === 'function') ? normName(p.name || p.nombre || '') : String(p.name || p.nombre || '').toLowerCase().trim()) === refKey)) || null;
  }

  const base = found || ((ref && typeof ref === 'object') ? ref : {});
  const name = String((base && (base.name || base.nombre || base.productName || base.label)) || refName || '').trim();
  const id = (base && (base.id ?? base.productId ?? base.productoId)) ?? refId;
  const capacityMl = reempaqueCapacityMlFromProductPOS(base && (base.name || base.nombre || base.productName) ? base : { name });

  return {
    id: (id === null || typeof id === 'undefined' || id === '') ? null : id,
    name,
    capacityMl: capacityMl > 0 ? capacityMl : null,
    raw: base || null
  };
}

async function reempaqueResolveEventInfoPOS(eventId){
  if (!db) await openDB();
  let eid = (eventId ?? null);
  if (eid === null || typeof eid === 'undefined' || eid === ''){
    try{ eid = await getMeta('currentEventId'); }catch(_){ eid = null; }
  }

  let ev = null;
  const n = Number(eid);
  if (Number.isFinite(n) && n > 0){
    try{ ev = await getOne('events', n); }catch(_){ ev = null; }
  }
  if (!ev && eid !== null && typeof eid !== 'undefined' && eid !== ''){
    try{
      const evs = await getAll('events');
      ev = (evs || []).find(x => x && String(x.id) === String(eid)) || null;
    }catch(_){ ev = null; }
  }
  return {
    eventId: (ev && ev.id != null) ? ev.id : ((eid === '' || typeof eid === 'undefined') ? null : eid),
    eventoId: (ev && ev.id != null) ? ev.id : ((eid === '' || typeof eid === 'undefined') ? null : eid),
    eventName: ev ? String(ev.name || ev.nombre || ev.code || ev.codigo || '') : '',
    nombreEvento: ev ? String(ev.name || ev.nombre || ev.code || ev.codigo || '') : '',
    eventCode: ev ? String(ev.code || ev.codigo || ev.name || ev.nombre || '') : '',
    eventoCodigo: ev ? String(ev.code || ev.codigo || ev.name || ev.nombre || '') : ''
  };
}

async function reempaqueCreateBaseRecordPOS(input={}){
  if (reempaqueHasMultipleDestinationsInputPOS(input) || reempaqueIsMultipleRecordPOS(input)){
    return await reempaquePrepareMultiplePayloadPOS(input || {});
  }
  if (!db) await openDB();
  const products = await getAll('products').catch(()=>[]);
  const now = reempaqueNowISOPOS();
  const evInfo = await reempaqueResolveEventInfoPOS(input.eventId ?? input.eventoId ?? input.eventRef ?? null);

  const src = reempaqueNormalizeProductRefPOS(
    input.productoOrigen ?? input.origen ?? input.sourceProduct ?? input.productSource ?? input.sourceProductId ?? null,
    products
  );
  const dst = reempaqueNormalizeProductRefPOS(
    input.productoDestino ?? input.destino ?? input.targetProduct ?? input.productTarget ?? input.targetProductId ?? null,
    products
  );

  const cantidadOrigen = reempaquePositivePOS(input.cantidadOrigen ?? input.sourceQty ?? input.qtyOrigen ?? input.originQty ?? 0);
  const cantidadCreadaDestino = reempaquePositivePOS(input.cantidadCreadaDestino ?? input.cantidadDestino ?? input.targetQty ?? input.qtyDestino ?? 0);
  const cantidadSugeridaPorVolumen = reempaqueComputeSuggestedQtyByVolumePOS(cantidadOrigen, src.capacityMl, dst.capacityMl);
  const cantidadFinalRegistrada = reempaquePositivePOS(
    input.cantidadFinalRegistrada ?? input.finalQty ?? input.cantidadFinal ?? cantidadCreadaDestino ?? cantidadSugeridaPorVolumen ?? 0
  );

  const costoUnitarioOrigen = reempaqueMoneyPOS(
    input.costoUnitarioOrigen ?? input.costoOrigenUnitario ?? input.sourceUnitCost ?? input.unitCostOrigin ?? 0
  );
  const costoOrigenTotalManual = reempaqueMoneyPOS(input.costoOrigenTotal ?? input.sourceCostTotal ?? 0);
  const costoOrigenTotal = costoOrigenTotalManual > 0
    ? costoOrigenTotalManual
    : ((costoUnitarioOrigen > 0 && cantidadOrigen > 0) ? round2(costoUnitarioOrigen * cantidadOrigen) : 0);
  const costoAdicionalUnitarioInput = reempaqueMoneyPOS(input.costoAdicionalUnitario ?? input.costoEmpaqueUnitario ?? input.extraUnitCost ?? input.additionalUnitCost ?? 0);
  const costoAdicionalTotalManual = reempaqueMoneyPOS(input.costoAdicionalTotal ?? input.costoEmpaqueTotal ?? input.extraCostTotal ?? 0);
  const costoAdicionalTotal = (costoAdicionalUnitarioInput > 0 && cantidadFinalRegistrada > 0)
    ? round2(costoAdicionalUnitarioInput * cantidadFinalRegistrada)
    : costoAdicionalTotalManual;
  const costoAdicionalUnitario = costoAdicionalUnitarioInput > 0
    ? costoAdicionalUnitarioInput
    : ((cantidadFinalRegistrada > 0 && costoAdicionalTotal > 0) ? round2(costoAdicionalTotal / cantidadFinalRegistrada) : 0);
  const costoLiquidoTotal = costoOrigenTotal;
  const costoLiquidoUnitario = (cantidadFinalRegistrada > 0 && costoLiquidoTotal > 0) ? round2(costoLiquidoTotal / cantidadFinalRegistrada) : 0;
  const costoTotalManual = reempaqueMoneyPOS(input.costoTotalReempaque ?? input.totalCostReempaque ?? 0);
  const costoTotalReempaque = (costoLiquidoTotal > 0 || costoAdicionalTotal > 0)
    ? round2(costoLiquidoTotal + costoAdicionalTotal)
    : costoTotalManual;
  const costoUnitarioDestino = (cantidadFinalRegistrada > 0 && costoTotalReempaque > 0)
    ? round2(costoTotalReempaque / cantidadFinalRegistrada)
    : reempaqueMoneyPOS(input.costoUnitarioDestino ?? input.targetUnitCost ?? 0);
  const costoFuenteOrigen = String(input.costoFuenteOrigen || input.costSourceOrigin || '').trim();

  return {
    id: String(input.id || reempaqueBuildIdPOS()),
    tipo: 'REEMPAQUE',
    nombreVisible: REEMPAQUE_VISIBLE_NAME_POS,
    fechaHora: String(input.fechaHora || input.date || now),
    date: String(input.date || input.fechaHora || now),
    timestamp: reempaqueNumPOS(input.timestamp, Date.now ? Date.now() : (new Date()).getTime()),
    eventId: evInfo.eventId,
    eventoId: evInfo.eventoId,
    eventName: evInfo.eventName,
    nombreEvento: evInfo.nombreEvento,
    eventCode: evInfo.eventCode,
    eventoCodigo: evInfo.eventoCodigo,

    productoOrigen: src.name,
    sourceProduct: { id: src.id, name: src.name, capacityMl: src.capacityMl },
    sourceProductId: src.id,
    sourceProductName: src.name,
    productoOrigenId: src.id,
    productoOrigenNombre: src.name,
    cantidadOrigen,
    capacidadOrigenMl: src.capacityMl,
    capacidadVolumenOrigen: src.capacityMl,

    productoDestino: dst.name,
    targetProduct: { id: dst.id, name: dst.name, capacityMl: dst.capacityMl },
    targetProductId: dst.id,
    targetProductName: dst.name,
    productoDestinoId: dst.id,
    productoDestinoNombre: dst.name,
    cantidadCreadaDestino,
    capacidadDestinoMl: dst.capacityMl,
    capacidadVolumenDestino: dst.capacityMl,

    cantidadSugeridaPorVolumen,
    cantidadFinalRegistrada,
    costoUnitarioOrigen,
    costoFuenteOrigen,
    costoOrigenTotal,
    costoLiquidoTotal,
    costoLiquidoDistribuido: costoLiquidoTotal,
    costoLiquidoUnitario,
    costoUnitarioLiquido: costoLiquidoUnitario,
    costoAdicionalUnitario,
    costoEmpaqueUnitario: costoAdicionalUnitario,
    costoAdicionalTotal,
    costoEmpaqueTotal: costoAdicionalTotal,
    costoTotalReempaque,
    costoUnitarioDestino,
    nota: String(input.nota || input.note || '').trim(),
    estado: String(input.estado || REEMPAQUE_STATUS_VALID_POS),
    estadoValido: true,
    valid: true,
    createdAt: String(input.createdAt || now),
    updatedAt: String(input.updatedAt || now)
  };
}

function reempaqueValidateRecordPOS(record){
  if (reempaqueIsMultipleRecordPOS(record) || reempaqueHasMultipleDestinationsInputPOS(record)){
    return reempaqueValidateMultipleRecordPOS(record || {});
  }
  const errors = [];
  const warnings = [];
  const r = record || {};
  const srcName = String(r.sourceProductName || r.productoOrigenNombre || r.productoOrigen || (r.sourceProduct && r.sourceProduct.name) || '').trim();
  const dstName = String(r.targetProductName || r.productoDestinoNombre || r.productoDestino || (r.targetProduct && r.targetProduct.name) || '').trim();
  const srcId = r.sourceProductId ?? r.productoOrigenId ?? (r.sourceProduct && r.sourceProduct.id);
  const dstId = r.targetProductId ?? r.productoDestinoId ?? (r.targetProduct && r.targetProduct.id);
  const qtyOrigen = reempaquePositivePOS(r.cantidadOrigen ?? r.sourceQty ?? r.qtyOrigen);
  const qtyDestino = reempaquePositivePOS(r.cantidadFinalRegistrada ?? r.cantidadCreadaDestino ?? r.cantidadDestino ?? r.targetQty);

  if (!srcName && (srcId === null || typeof srcId === 'undefined' || srcId === '')) errors.push('producto_origen_requerido');
  if (!dstName && (dstId === null || typeof dstId === 'undefined' || dstId === '')) errors.push('producto_destino_requerido');
  if (!(qtyOrigen > 0)) errors.push('cantidad_origen_mayor_cero');
  if (!(qtyDestino > 0)) errors.push('cantidad_destino_mayor_cero');
  if (!srcName && !dstName && (srcId === null || typeof srcId === 'undefined') && (dstId === null || typeof dstId === 'undefined')) errors.push('origen_y_destino_vacios');

  const srcMl = reempaquePositivePOS(r.capacidadOrigenMl ?? (r.sourceProduct && r.sourceProduct.capacityMl));
  const dstMl = reempaquePositivePOS(r.capacidadDestinoMl ?? (r.targetProduct && r.targetProduct.capacityMl));
  if (!(srcMl > 0)) warnings.push('origen_sin_capacidad_ml');
  if (!(dstMl > 0)) warnings.push('destino_sin_capacidad_ml');

  return { ok: errors.length === 0, errors, warnings };
}

async function reempaqueSaveRecordPOS(record){
  if (!db) await openDB();
  const needsMultiPrep = reempaqueHasMultipleDestinationsInputPOS(record) || reempaqueIsMultipleRecordPOS(record);
  const base = needsMultiPrep
    ? await reempaquePrepareMultiplePayloadPOS(record || {})
    : (record && record.id ? { ...record } : await reempaqueCreateBaseRecordPOS(record || {}));
  const validation = reempaqueValidateRecordPOS(base);
  if (!validation.ok){
    const err = new Error('Reempaque inválido: ' + validation.errors.join(', '));
    try{ err.validation = validation; }catch(_){ }
    throw err;
  }
  const now = reempaqueNowISOPOS();
  base.updatedAt = now;
  if (!base.createdAt) base.createdAt = now;
  base.estado = base.estado || REEMPAQUE_STATUS_VALID_POS;
  base.estadoValido = true;
  base.valid = true;
  await put(REEMPAQUE_STORE_POS, base);
  return base;
}

async function reempaqueSaveManyPOS(records){
  if (!Array.isArray(records)) throw new Error('Reempaque: records debe ser un arreglo');
  const out = [];
  for (const r of records){
    out.push(await reempaqueSaveRecordPOS(r));
  }
  return out;
}

async function reempaqueLoadForEventPOS(eventId){
  if (!db) await openDB();
  const evInfo = await reempaqueResolveEventInfoPOS(eventId);
  const eid = evInfo.eventId;
  if (eid === null || typeof eid === 'undefined' || eid === '') return [];

  const keys = [];
  const n = Number(eid);
  if (Number.isFinite(n)) keys.push(n);
  keys.push(String(eid));

  const seen = new Set();
  const allRows = [];
  for (const key of keys){
    const keySig = (typeof key) + ':' + String(key);
    if (seen.has(keySig)) continue;
    seen.add(keySig);
    const rows = await new Promise((resolve)=>{
      try{
        if (!db || !db.objectStoreNames.contains(REEMPAQUE_STORE_POS)){ resolve([]); return; }
        const tr = db.transaction([REEMPAQUE_STORE_POS], 'readonly');
        const st = tr.objectStore(REEMPAQUE_STORE_POS);
        let idx = null;
        try{ idx = st.index('by_event'); }catch(_){ idx = null; }
        if (!idx){ resolve(null); return; }
        const req = idx.getAll(IDBKeyRange.only(key));
        req.onsuccess = ()=> resolve(req.result || []);
        req.onerror = ()=> resolve([]);
      }catch(_){ resolve([]); }
    });
    if (Array.isArray(rows)) allRows.push(...rows);
  }

  let out = allRows;
  if (!out.length){
    try{
      const all = await getAll(REEMPAQUE_STORE_POS);
      out = (Array.isArray(all) ? all : []).filter(r => r && String(r.eventId) === String(eid));
    }catch(_){ out = []; }
  }

  const uniq = new Map();
  for (const r of out){ if (r && r.id) uniq.set(String(r.id), r); }
  return Array.from(uniq.values()).sort((a,b)=> String(b.createdAt || b.fechaHora || '').localeCompare(String(a.createdAt || a.fechaHora || '')));
}

// Aliases internos en español para futuras etapas/UI sin duplicar lógica.
const cargarReempaquesDelEventoPOS = reempaqueLoadForEventPOS;
const guardarReempaquePOS = reempaqueSaveRecordPOS;
const guardarReempaquesPOS = reempaqueSaveManyPOS;
const crearRegistroBaseReempaquePOS = reempaqueCreateBaseRecordPOS;
const validarReempaquePOS = reempaqueValidateRecordPOS;
const calcularCantidadSugeridaReempaquePOS = reempaqueComputeSuggestedQtyByVolumePOS;

try{
  window.A33_POS_REEMPAQUE = Object.freeze({
    label: REEMPAQUE_VISIBLE_NAME_POS,
    store: REEMPAQUE_STORE_POS,
    loadForEvent: reempaqueLoadForEventPOS,
    saveRecord: reempaqueSaveRecordPOS,
    saveMany: reempaqueSaveManyPOS,
    createBaseRecord: reempaqueCreateBaseRecordPOS,
    validateRecord: reempaqueValidateRecordPOS,
    applyMovement: reempaqueApplyMovementPOS,
    registerMovement: reempaqueApplyMovementPOS,
    applyMultipleMovement: reempaqueApplyMultipleMovementPOS,
    prepareMultiplePayload: reempaquePrepareMultiplePayloadPOS,
    validateMultipleRecord: reempaqueValidateMultipleRecordPOS,
    hasMultipleDestinations: reempaqueHasMultipleDestinationsInputPOS,
    totalVolume: reempaqueTotalVolumePOS,
    costPerMl: reempaqueCostPerMlPOS,
    suggestQtyByVolume: reempaqueComputeSuggestedQtyByVolumePOS,
    getCapacityMl: reempaqueCapacityMlFromProductPOS
  });
}catch(_){ }

// Limpiar múltiples stores de forma atómica (si falla uno, no se borra ninguno).
function clearStoresAtomicPOS(storeNames){
  return new Promise((resolve, reject)=>{
    try{
      const stores = Array.isArray(storeNames) ? storeNames.filter(Boolean) : [];
      if (!stores.length) { resolve(true); return; }
      const t = db.transaction(stores, 'readwrite');
      for (const s of stores){
        try{ t.objectStore(s).clear(); }
        catch(err){
          try{ t.abort(); }catch(_){ }
          reject(err);
          return;
        }
      }
      t.oncomplete = ()=>resolve(true);
      t.onerror = ()=>reject(t.error || new Error('Error limpiando stores'));
      t.onabort = ()=>reject(t.error || new Error('Transacción abortada limpiando stores'));
    }catch(err){
      reject(err);
    }
  });
}
function del(name, key){
  // Borrado robusto (especialmente para 'sales'):
  // - Evita TransactionInactiveError (no dejamos una tx abierta esperando promesas externas)
  // - Nunca "resuelve en silencio" si no pudo borrar
  // - Devuelve { ok:true, warnings:[] } cuando aplica
  return new Promise((resolve, reject) => {
    try{
      if (name !== 'sales'){
        const store = tx(name,'readwrite');
        const r = store.delete(key);
        r.onsuccess = ()=>resolve({ok:true, warnings:[]});
        r.onerror = ()=>reject(r.error);
        return;
      }

      // helpers locales
      const idbGet = (storeName, k) => new Promise((res, rej) => {
        try{
          const st = tx(storeName);
          const r = st.get(k);
          r.onsuccess = ()=>res(r.result);
          r.onerror = ()=>rej(r.error);
        }catch(err){ rej(err); }
      });

      const idbDelete = (storeName, k) => new Promise((res, rej) => {
        try{
          const t = db.transaction([storeName], 'readwrite');
          const st = t.objectStore(storeName);
          try{ st.delete(k); } catch (err){ rej(err); return; }
          t.oncomplete = ()=>res();
          t.onerror = (e)=>rej(t.error || e.target?.error || new Error('Error eliminando registro en ' + storeName));
          t.onabort = (e)=>rej(t.error || e.target?.error || new Error('Transacción abortada eliminando registro en ' + storeName));
        }catch(err){ rej(err); }
      });

      (async ()=>{
        const warnings = [];

        // 1) Traer la venta (fuera de cualquier tx de borrado)
        const sale = await idbGet('sales', key);

        if (!sale){
          // Si no existe, intentamos borrar de todas formas (por si el key es string/number mismatch),
          // y reportamos que ya estaba ausente.
          try{
            await idbDelete('sales', key);
          }catch(err){
            throw err;
          }
          return resolve({ok:true, warnings: ['La venta no se encontró (posible ya estaba eliminada).']});
        }

        // 2) Borrar la venta primero (objetivo principal). Si falla, no hacemos side-effects.
        await idbDelete('sales', key);

        // 2.1) Verificación rápida (mejor error que "parece que borró")
        try{
          const still = await idbGet('sales', key);
          if (still){
            throw new Error('La venta no se pudo eliminar (el registro sigue existiendo).');
          }
        }catch(verErr){
          // Si falla la verificación por lectura, no bloqueamos: solo advertimos.
          console.warn('No se pudo verificar el borrado de la venta', verErr);
        }

        // 3) Side-effects (no bloquean el borrado): revertir inventario central + borrar asientos en Finanzas
        try{
          applyFinishedFromSalePOS(sale, -1);
        }catch(e){
          console.error('Error revertiendo inventario central al eliminar venta', e);
          warnings.push('No se pudo revertir inventario central (la venta sí se eliminó).');
        }

        // Revertir consumo de vasos (FIFO) si esta venta/cortesía fue por vaso
        try{
          await revertCupConsumptionFromSalePOS(sale);
        }catch(e){
          console.error('Error revertiendo vasos al eliminar venta', e);
          warnings.push('No se pudieron revertir vasos de sangría (la venta sí se eliminó).');
        }


        // VASOS (Etapa 3/3): Revertir consumible Vasos 12oz (Tapas Auto) por operación (idempotente)
        try{
          if (sale && isCupSaleRecord(sale)){
            const vSrc = (sale.invEffects && sale.invEffects.vasos12oz && sale.invEffects.vasos12oz.sourceId)
              ? String(sale.invEffects.vasos12oz.sourceId)
              : getVasos12ozSourceIdFromSalePOS(sale);
            const qRaw = (sale.invEffects && sale.invEffects.vasos12oz && (sale.invEffects.vasos12oz.qtyApplied ?? sale.invEffects.vasos12oz.qty))
              ?? sale.qty;
            const q = toIntSafePOS(qRaw, 0);
            const rCap = adjustVasos12ozStockFromPOS(q, { sourceId: vSrc, mode:'revert' });
            if (rCap && rCap.ok){
              // ok (o skipped por idempotencia)
            } else {
              warnings.push('No se pudieron revertir Vasos 12oz (la venta sí se eliminó).');
            }
          }
        }catch(e){
          console.error('Error revertiendo Vasos 12oz al eliminar venta', e);
          warnings.push('No se pudieron revertir Vasos 12oz (la venta sí se eliminó).');
        }

        try{
          const saleId = (sale.id != null) ? sale.id : key;
          await Promise.resolve(deleteFinanzasEntriesForSalePOS(saleId));
        }catch(e){
          console.error('Error eliminando asientos contables vinculados a la venta', e);
          warnings.push('No se pudieron eliminar asientos en Finanzas (la venta sí se eliminó).');
        }

        resolve({ok:true, warnings});
      })().catch(err=>{
        console.error('Error en del("sales")', err);
        reject(err);
      });
    }catch(err){
      console.error('Error general en del()', err);
      reject(err);
    }
  });
}


async function setMeta(key, value){
  return put('meta', {id:key, value});
}
async function getMeta(key){ 
  const all = await getAll('meta');
  const row = all.find(x=>x.id===key);
  return row ? row.value : null;
}

// --- Resumen: selector GLOBAL vs Evento (estado separado, persistente)
const SUMMARY_EVENT_GLOBAL_POS = 'GLOBAL';
const SUMMARY_EVENT_META_KEY_POS = 'selectedSummaryEventId';
let __A33_SELECTED_SUMMARY_EVENT_ID_CACHE = null;

async function getSelectedSummaryEventIdPOS(){
  try{
    if (__A33_SELECTED_SUMMARY_EVENT_ID_CACHE != null) return String(__A33_SELECTED_SUMMARY_EVENT_ID_CACHE);
  }catch(_){ }
  let v = null;
  try{ v = await getMeta(SUMMARY_EVENT_META_KEY_POS); }catch(_){ v = null; }
  if (v == null || v === '') v = SUMMARY_EVENT_GLOBAL_POS;
  const s = String(v);
  __A33_SELECTED_SUMMARY_EVENT_ID_CACHE = s;
  return s;
}

async function setSelectedSummaryEventIdPOS(val){
  let v = (val == null || val === '') ? SUMMARY_EVENT_GLOBAL_POS : String(val);
  __A33_SELECTED_SUMMARY_EVENT_ID_CACHE = v;
  try{ await setMeta(SUMMARY_EVENT_META_KEY_POS, v); }catch(_){ }
  return v;
}

function isSummaryGlobalPOS(v){
  return String(v || '') === SUMMARY_EVENT_GLOBAL_POS;
}

function parseSummaryEventIdPOS(v){
  if (isSummaryGlobalPOS(v)) return null;
  const n = parseInt(String(v || ''), 10);
  if (!Number.isFinite(n)) return null;
  return n;
}


const LAST_GROUP_KEY = 'a33_pos_lastGroupName';
const HIDDEN_GROUPS_KEY = 'a33_pos_hiddenGroups';
// Catálogo persistente de grupos (Evento Maestro) para NO depender de eventos históricos.
// - Se usa para mantener: nombres + orden de grupos, incluso después de Cerrar período.
// - Compatibilidad: si no existe, se deriva de eventos existentes.
const GROUP_CATALOG_KEY = 'a33_pos_groupCatalog_v1';


// --- Ventas: Cliente (selector + pegajoso; administración en Catálogos)
// Etapa 2 (Datos): catálogo con customerId + migración suave. Analítica sigue usando customerName.
const CUSTOMER_CATALOG_KEY = 'a33_pos_customersCatalog';
const CUSTOMER_DISABLED_KEY = 'a33_pos_customersDisabled'; // legado (Etapa 1). En Etapa 2 se mantiene sincronizado.
const CUSTOMER_STICKY_KEY  = 'a33_pos_customerSticky';
const CUSTOMER_LAST_KEY    = 'a33_pos_customerLast';
	// Preferencias UI (Gestionar clientes)
	const CUSTOMER_MANAGE_FILTER_KEY = 'a33_pos_customerManageFilter'; // 'active' | 'all'
	const CUSTOMER_MANAGE_COMPACT_KEY = 'a33_pos_customerManageCompact'; // '1' | '0'
	const CUSTOMER_MANAGE_OPEN_KEY = 'a33_pos_customerManageOpenGroups'; // JSON {A:true,...}

function normalizeCustomerKeyPOS(name){
  let s = (name || '').toString();
  try{ if (s.normalize) s = s.normalize('NFD'); }catch(_){ }
  return s
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\s+/g,' ')
    .trim();
}

function sanitizeCustomerDisplayPOS(name){
  return (name || '').toString().replace(/\s+/g,' ').trim();
}

function sortCustomerObjectsAZ_POS(list){
  return (Array.isArray(list) ? list : [])
    .slice()
    .sort((a,b)=> normalizeCustomerKeyPOS(a && a.name).localeCompare(normalizeCustomerKeyPOS(b && b.name)));
}

function loadCustomerDisabledSetPOS(){
  const raw = A33Storage.getJSON(CUSTOMER_DISABLED_KEY, [], 'local');
  const set = new Set();
  if (Array.isArray(raw)){
    for (const v of raw){
      const k = (v || '').toString().trim();
      if (k) set.add(k);
    }
  } else if (raw && typeof raw === 'object'){
    // compat futuro: { key:true }
    for (const k in raw){
      if (raw[k]){
        const kk = (k || '').toString().trim();
        if (kk) set.add(kk);
      }
    }
  }
  return set;
}

function saveCustomerDisabledSetPOS(set){
  try{
    const arr = Array.from(set || []).filter(Boolean);
    A33Storage.setJSON(CUSTOMER_DISABLED_KEY, arr, 'local');
  }catch(_){ }
}

function generateCustomerIdPOS(existingIds){
  const used = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  let id = '';
  for (let i=0;i<6;i++){
    id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,9);
    if (!used.has(id)) break;
  }
  return id || ('c_' + Date.now().toString(36));
}

function coerceCustomerObjectPOS(raw, disabledSet, existingIds){
  // Acepta string u objeto y devuelve objeto válido o null
  if (typeof raw === 'string'){
    const name = sanitizeCustomerDisplayPOS(raw);
    if (!name) return null;
    const normalizedName = normalizeCustomerKeyPOS(name);
    if (!normalizedName) return null;
    const id = generateCustomerIdPOS(existingIds);
    existingIds.add(id);
    return {
      id,
      name,
      isActive: !disabledSet.has(normalizedName),
      createdAt: Date.now(),
      updatedAt: null,
      normalizedName,
      celular: '',
      telefono: '',
      whatsapp: '',
      correo: '',
      direccion: '',
      notas: '',
      // Clientes v3 (Identidad): campos opcionales (migración suave)
      aliases: [],
      nameHistory: [],
      mergedIntoId: null,
      mergedAt: null,
      mergeReason: '',
      mergeHistory: []
    };
  }

  if (!raw || typeof raw !== 'object') return null;

  const name = sanitizeCustomerDisplayPOS(raw.name || raw.customerName || raw.customer || '');
  if (!name) return null;
  const normalizedName = normalizeCustomerKeyPOS(name);
  if (!normalizedName) return null;

  let id = (raw.id != null) ? String(raw.id) : '';
  if (!id || existingIds.has(id)){
    id = generateCustomerIdPOS(existingIds);
  }
  existingIds.add(id);

  let isActive;
  if (typeof raw.isActive === 'boolean') isActive = raw.isActive;
  else if (typeof raw.active === 'boolean') isActive = raw.active;
  else isActive = !disabledSet.has(normalizedName);

  const createdAtNum = Number(raw.createdAt);
  const createdAt = (Number.isFinite(createdAtNum) && createdAtNum > 0) ? createdAtNum : Date.now();

  const updatedAtNum = Number(raw.updatedAt);
  const updatedAt = (Number.isFinite(updatedAtNum) && updatedAtNum > 0) ? updatedAtNum : null;

  const aliases = Array.isArray(raw.aliases) ? raw.aliases.map(sanitizeCustomerDisplayPOS).filter(Boolean) : [];
  const nameHistory = Array.isArray(raw.nameHistory)
    ? raw.nameHistory
      .map(h => {
        if (!h || typeof h !== 'object') return null;
        const from = sanitizeCustomerDisplayPOS(h.from || '');
        const to = sanitizeCustomerDisplayPOS(h.to || '');
        const atNum = Number(h.at);
        const at = (Number.isFinite(atNum) && atNum > 0) ? atNum : null;
        const reason = sanitizeCustomerDisplayPOS(h.reason || '');
        if (!from && !to) return null;
        return { from, to, at, reason };
      })
      .filter(Boolean)
    : [];

  const mergeHistory = Array.isArray(raw.mergeHistory)
    ? raw.mergeHistory
      .map(h => {
        if (!h || typeof h !== 'object') return null;
        const fromId = (h.fromId != null) ? String(h.fromId).trim() : '';
        const fromName = sanitizeCustomerDisplayPOS(h.fromName || '');
        const atNum = Number(h.at);
        const at = (Number.isFinite(atNum) && atNum > 0) ? atNum : null;
        const reason = sanitizeCustomerDisplayPOS(h.reason || '');
        if (!fromId && !fromName) return null;
        return { fromId, fromName, at, reason };
      })
      .filter(Boolean)
    : [];

  const mergedIntoId = (raw.mergedIntoId != null && String(raw.mergedIntoId).trim()) ? String(raw.mergedIntoId).trim() : null;
  const mergedAtNum = Number(raw.mergedAt);
  const mergedAt = (Number.isFinite(mergedAtNum) && mergedAtNum > 0) ? mergedAtNum : null;
  const mergeReason = sanitizeCustomerDisplayPOS(raw.mergeReason || '');

  const celular = sanitizeCustomerDisplayPOS(raw.celular || raw.cellular || raw.mobile || raw.movil || raw.whatsapp || raw.wa || raw.whatsApp || raw.telefono || raw.phone || raw.telefonoCliente || '');

  return {
    ...raw,
    id,
    name,
    nombre: sanitizeCustomerDisplayPOS(raw.nombre || name),
    celular,
    telefono: celular,
    whatsapp: '',
    correo: sanitizeCustomerDisplayPOS(raw.correo || raw.email || raw.mail || ''),
    direccion: sanitizeCustomerDisplayPOS(raw.direccion || raw.address || ''),
    notas: String(raw.notas || raw.notes || '').trim(),
    isActive: !!isActive,
    active: !!isActive,
    createdAt,
    updatedAt,
    normalizedName,
    aliases,
    nameHistory,
    mergedIntoId,
    mergedAt,
    mergeReason,
    mergeHistory
  };
}

function resolveFinalCustomerIdPOS(id, byId){
  const start = (id != null) ? String(id).trim() : '';
  if (!start) return '';
  const seen = new Set();
  let cur = start;
  while (cur){
    if (seen.has(cur)) break;
    seen.add(cur);
    const c = byId.get(cur);
    if (!c) break;
    const next = (c.mergedIntoId != null) ? String(c.mergedIntoId).trim() : '';
    if (!next) break;
    cur = next;
  }
  return cur;
}

function collectCustomerAllNamesPOS(c){
  const out = [];
  if (!c) return out;
  if (c.name) out.push(String(c.name));
  if (Array.isArray(c.aliases)) out.push(...c.aliases);
  if (Array.isArray(c.nameHistory)){
    for (const h of c.nameHistory){
      if (!h || typeof h !== 'object') continue;
      if (h.from) out.push(String(h.from));
      if (h.to) out.push(String(h.to));
    }
  }
  return out.map(sanitizeCustomerDisplayPOS).filter(Boolean);
}

function buildCustomerResolverPOS(catalog){
  const list = Array.isArray(catalog) ? catalog : [];
  const byId = new Map();
  for (const c of list){
    if (c && c.id != null){
      const id = String(c.id).trim();
      if (id) byId.set(id, c);
    }
  }

  const keyToFinalId = new Map();
  const ambiguous = new Set();

  const addKey = (k, finalId)=>{
    if (!k) return;
    if (ambiguous.has(k)) return;
    const prev = keyToFinalId.get(k);
    if (prev && prev !== finalId){
      keyToFinalId.delete(k);
      ambiguous.add(k);
      return;
    }
    keyToFinalId.set(k, finalId);
  };

  for (const c of list){
    if (!c || c.id == null) continue;
    const finalId = resolveFinalCustomerIdPOS(c.id, byId);
    const names = collectCustomerAllNamesPOS(c);
    for (const nm of names){
      addKey(normalizeCustomerKeyPOS(nm), finalId);
    }
  }

  const matchNameToFinalId = (name)=>{
    const n = sanitizeCustomerDisplayPOS(name);
    if (!n) return '';
    const k = normalizeCustomerKeyPOS(n);
    if (!k) return '';
    return keyToFinalId.get(k) || '';
  };

  const getDisplayName = (finalId)=>{
    const fid = (finalId != null) ? String(finalId).trim() : '';
    if (!fid) return '';
    const c = byId.get(fid);
    return c && c.name ? sanitizeCustomerDisplayPOS(c.name) : '';
  };

  return { byId, resolveFinalId:(id)=> resolveFinalCustomerIdPOS(id, byId), matchNameToFinalId, getDisplayName, keyToFinalId, ambiguous };
}

function migrateCustomerCatalogToObjectsPOS(){
  let raw = [];
  try{
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function') raw = A33Storage.sharedGet(CUSTOMER_CATALOG_KEY, [], 'local');
    else raw = A33Storage.getJSON(CUSTOMER_CATALOG_KEY, [], 'local');
  }catch(_){ raw = []; }
  const disabled = loadCustomerDisabledSetPOS();

  const existingIds = new Set();
  const out = [];
  let changed = false;

  if (Array.isArray(raw)){
    for (const item of raw){
      const obj = coerceCustomerObjectPOS(item, disabled, existingIds);
      if (!obj) { if (item) changed = true; continue; }

      // Etapa 3/3: migración conservadora.
      // No fusionar ni borrar duplicados por nombre: se preservan IDs y datos existentes.
      // El selector operativo deduplica visualmente cuando puede hacerlo sin destruir información.
      if (typeof item === 'string') changed = true;
      else {
        if (!item.id || item.normalizedName !== obj.normalizedName || typeof item.isActive !== 'boolean' || typeof item.createdAt !== 'number') changed = true;
      }

      out.push(obj);
    }
  } else {
    // Algo raro guardado: lo normalizamos a vacío
    if (raw) changed = true;
  }

  const sorted = sortCustomerObjectsAZ_POS(out);

  // Sincronizar disabled legacy basado en isActive
  const disabled2 = new Set();
  for (const c of sorted){
    if (c && c.isActive === false && c.normalizedName) disabled2.add(c.normalizedName);
  }
  try{
    // Guardar siempre si hubo migración o si hay divergencia con disabled existente
    const oldDisabledArr = Array.from(disabled).sort().join('|');
    const newDisabledArr = Array.from(disabled2).sort().join('|');
    if (changed || oldDisabledArr !== newDisabledArr){
      if (window.A33Storage && typeof A33Storage.sharedSet === 'function'){
      const r = A33Storage.sharedSet(CUSTOMER_CATALOG_KEY, sorted, { source: 'pos' });
      if (!r || !r.ok) throw new Error((r && r.message) ? r.message : 'No se pudo guardar catalogo de clientes.');
    } else {
      A33Storage.setJSON(CUSTOMER_CATALOG_KEY, sorted, 'local');
    }
      saveCustomerDisabledSetPOS(disabled2);
    }
  }catch(_){ }

  return sorted;
}

function loadCustomerCatalogPOS(){
  // Siempre devolvemos objetos (id, name, isActive, createdAt, normalizedName)
  return migrateCustomerCatalogToObjectsPOS();
}


function mergeCustomerCatalogByIdKeepPOS(cur, next){
  const map = new Map();
  const order = [];
  const add = (item) => {
    if (!item || item.id == null) return;
    const id = String(item.id);
    if (!id) return;
    if (!map.has(id)) order.push(id);
    map.set(id, item);
  };
  for (const c of (Array.isArray(cur) ? cur : [])) add(c);
  for (const c of (Array.isArray(next) ? next : [])) add(c);
  return order.map(id => map.get(id)).filter(Boolean);
}

function saveCustomerCatalogPOS(list){
  const safe = Array.isArray(list) ? list : [];
  try{
    if (window.A33Storage && typeof A33Storage.sharedRead === 'function' && typeof A33Storage.sharedSet === 'function'){
      const r0 = A33Storage.sharedRead(CUSTOMER_CATALOG_KEY, [], 'local');
      const cur = (r0 && Array.isArray(r0.data)) ? r0.data : [];
      const baseRev = (r0 && r0.meta && typeof r0.meta.rev === 'number') ? r0.meta.rev : null;

      // Releer + merge conservador por ID: nunca sobrescribir todo a ciegas.
      const merged = mergeCustomerCatalogByIdKeepPOS(cur, safe);
      const sorted = sortCustomerObjectsAZ_POS(merged);

      const r = A33Storage.sharedSet(CUSTOMER_CATALOG_KEY, sorted, { source: 'pos', baseRev });
      if (!r || !r.ok){
        try{ showToast((r && r.message) ? r.message : 'Conflicto al guardar clientes. Recargá e intentá de nuevo.', 'error', 4200); }catch(_){ }
        return false;
      }
      return true;
    }

    if (window.A33Storage && typeof A33Storage.sharedSet === 'function'){
      const r = A33Storage.sharedSet(CUSTOMER_CATALOG_KEY, safe, { source: 'pos' });
      if (!r || !r.ok){
        try{ showToast((r && r.message) ? r.message : 'Conflicto al guardar clientes. Recargá e intentá de nuevo.', 'error', 4200); }catch(_){ }
        return false;
      }
      return true;
    }

    A33Storage.setJSON(CUSTOMER_CATALOG_KEY, safe, 'local');
    return true;
  }catch(_){
    return false;
  }
}

function syncDisabledLegacyFromCatalogPOS(list){
  // Siempre recalcular sobre el estado guardado (evita perder flags si hubo merge)
  let latest = [];
  try{ latest = loadCustomerCatalogPOS(); }catch(_){ latest = Array.isArray(list) ? list : []; }
  const set = new Set();
  for (const c of (Array.isArray(latest) ? latest : [])){
    if (c && c.isActive === false && c.normalizedName) set.add(c.normalizedName);
  }
  saveCustomerDisabledSetPOS(set);
}

function getCustomerManageFilterPOS(){
  const v = (A33Storage.getItem(CUSTOMER_MANAGE_FILTER_KEY) || '').toString().trim();
  return (v === 'all') ? 'all' : 'active';
}

function setCustomerManageFilterPOS(mode){
  const m = (mode === 'all') ? 'all' : 'active';
  try{ A33Storage.setItem(CUSTOMER_MANAGE_FILTER_KEY, m); }catch(_){ }
}

function isCustomerManageCompactPOS(){
  return (A33Storage.getItem(CUSTOMER_MANAGE_COMPACT_KEY) === '1');
}

function setCustomerManageCompactPOS(on){
  try{ A33Storage.setItem(CUSTOMER_MANAGE_COMPACT_KEY, on ? '1' : '0'); }catch(_){ }
}

function loadCustomerManageOpenMapPOS(){
  const raw = A33Storage.getJSON(CUSTOMER_MANAGE_OPEN_KEY, null, 'local');
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

function saveCustomerManageOpenMapPOS(map){
  try{ A33Storage.setJSON(CUSTOMER_MANAGE_OPEN_KEY, (map && typeof map === 'object') ? map : {}, 'local'); }catch(_){ }
}

function getCustomerGroupLetterPOS(name){
  const n = sanitizeCustomerDisplayPOS(name);
  if (!n) return '#';
  const norm = normalizeCustomerKeyPOS(n);
  const ch = (norm || '').charAt(0).toUpperCase();
  return (ch >= 'A' && ch <= 'Z') ? ch : '#';
}

function applyCustomerManageUIStatePOS(){
  const panel = document.getElementById('customer-manage-panel');
  if (panel){
    if (isCustomerManageCompactPOS()) panel.classList.add('compact');
    else panel.classList.remove('compact');
  }

  const filter = getCustomerManageFilterPOS();
  const btnA = document.getElementById('customer-manage-filter-active');
  const btnT = document.getElementById('customer-manage-filter-all');
  if (btnA) btnA.classList.toggle('is-active', filter === 'active');
  if (btnT) btnT.classList.toggle('is-active', filter === 'all');

  const compact = document.getElementById('customer-manage-compact');
  if (compact) compact.checked = isCustomerManageCompactPOS();
}

function setAllCustomerManageGroupsPOS(open){
  // Aplica a la vista sin búsqueda (A→Z) según filtro actual
  const filter = getCustomerManageFilterPOS();
  let items = loadCustomerCatalogPOS();
  if (filter === 'active') items = items.filter(c => c && c.isActive !== false);
  items = sortCustomerObjectsAZ_POS(items);

  const letters = new Set();
  for (const c of items){
    letters.add(getCustomerGroupLetterPOS(c && c.name));
  }
  const map = {};
  for (const l of letters){
    map[l] = !!open;
  }
  saveCustomerManageOpenMapPOS(map);
}

function isCustomerStickyPOS(){
  const el = document.getElementById('sale-customer-sticky');
  return !!(el && el.checked);
}

function getCustomerNameFromUI_POS(){
  const inp = document.getElementById('sale-customer');
  return sanitizeCustomerDisplayPOS(inp ? inp.value : '');
}

function getCustomerIdHintFromUI_POS(){
  const inp = document.getElementById('sale-customer');
  const raw = (inp && inp.dataset) ? String(inp.dataset.customerId || '').trim() : '';
  return raw || null;
}

function setCustomerSelectionUI_POS(customer){
  const inp = document.getElementById('sale-customer');
  if (!inp) return;
  const name = sanitizeCustomerDisplayPOS(customer && customer.name);
  inp.value = name;
  if (inp.dataset){
    if (customer && customer.id) inp.dataset.customerId = String(customer.id);
    else delete inp.dataset.customerId;
  }
}

function clearCustomerSelectionUI_POS(){
  const inp = document.getElementById('sale-customer');
  if (!inp) return;
  inp.value = '';
  if (inp.dataset) delete inp.dataset.customerId;
}

function getSaleCustomerSnapshotNamePOS(s){
  // Snapshot conservador: histórico primero. Nunca reescribe por nombre actual del catálogo.
  return sanitizeCustomerDisplayPOS(s && (s.customerName || s.customer || ''));
}

function dedupeSelectableCustomersPOS(list){
  const out = [];
  const seen = new Set();
  for (const c of (Array.isArray(list) ? list : [])){
    if (!c || c.isActive === false || c.mergedIntoId) continue;
    const key = normalizeCustomerKeyPOS(c.name || c.normalizedName || '');
    const id = (c.id != null) ? String(c.id).trim() : '';
    const dedupeKey = key || ('id:' + id);
    if (dedupeKey && seen.has(dedupeKey)) continue;
    if (dedupeKey) seen.add(dedupeKey);
    out.push(c);
  }
  return sortCustomerObjectsAZ_POS(out);
}

function validateCurrentCustomerSelectionPOS({ updateName = true } = {}){
  const inp = document.getElementById('sale-customer');
  if (!inp) return false;
  const rawName = sanitizeCustomerDisplayPOS(inp.value || '');
  const rawId = (inp.dataset) ? String(inp.dataset.customerId || '').trim() : '';
  if (!rawName && !rawId){
    persistCustomerLastPOS('');
    return false;
  }

  const resolved = resolveCustomerIdForSalePOS(rawName, rawId || null);
  if (resolved && resolved.id){
    const displayName = resolved.displayName || rawName;
    if (updateName) setCustomerSelectionUI_POS({ id: String(resolved.id), name: displayName });
    if (isCustomerStickyPOS()) persistCustomerLastPOS(displayName);
    return true;
  }

  // Cliente desactivado/eliminado/fusionado inválido: fallback seguro.
  clearCustomerSelectionUI_POS();
  persistCustomerLastPOS('');
  return false;
}


// Etapa 2 (POS): al cambiar de evento, limpiar cliente seleccionado (UI + persistencia)
function clearCustomerSelectionOnEventSwitchPOS(){
  try{ clearCustomerSelectionUI_POS(); }catch(_){ }
  try{
    if (window.A33Storage && typeof A33Storage.removeItem === 'function') A33Storage.removeItem(CUSTOMER_LAST_KEY, 'local');
    else if (window.localStorage) window.localStorage.removeItem(CUSTOMER_LAST_KEY);
  }catch(_){ }
}


// Etapa 2 (POS): Reset limpio al cambiar evento (sin estados pegajosos)
async function resetOperationalStateOnEventSwitchPOS(){
  // 1) Cliente (incluye dataset + storage del último cliente)
  try{ clearCustomerSelectionOnEventSwitchPOS(); }catch(_){ }

  // 2) Resumen: filtro por cliente (estado operativo, no preferencia visual)
  try{ clearSummaryCustomerFilterPOS({ silentUI: false }); }catch(_){ }

  // 3) Venta normal: inputs y toggles
  try{
    const qty = document.getElementById('sale-qty');
    if (qty) qty.value = '1';
    const disc = document.getElementById('sale-discount');
    if (disc) disc.value = '0';
    const notes = document.getElementById('sale-notes');
    if (notes) notes.value = '';
    const courtesy = document.getElementById('sale-courtesy');
    if (courtesy) courtesy.checked = false;
    const courtesyTo = document.getElementById('sale-courtesy-to');
    if (courtesyTo){
      courtesyTo.value = '';
      courtesyTo.disabled = true;
    }
    const isReturn = document.getElementById('sale-return');
    if (isReturn) isReturn.checked = false;

    // Producto: volver a un producto base (evitar extras/evento anterior)
    const sel = document.getElementById('sale-product');
    if (sel && sel.options && sel.options.length){
      let picked = false;
      for (let i=0;i<sel.options.length;i++){
        const v = String(sel.options[i].value || '');
        if (v && !v.startsWith('extra:')){
          sel.selectedIndex = i;
          picked = true;
          break;
        }
      }
      if (!picked) sel.selectedIndex = 0;
      try{ await setSalePriceFromSelectionPOS(); }catch(_){ }
      try{ updateChipsActiveFromSelectionPOS(); }catch(_){ }
    }

    // Pago: por defecto efectivo (y refrescar selector de banco)
    const pay = document.getElementById('sale-payment');
    if (pay) pay.value = 'efectivo';
    try{ await refreshSaleBankSelect(); }catch(_){ }

    // Total
    try{ recomputeTotal(); }catch(_){ }
    try{ resetSaleCashTenderPOS(); }catch(_){ }
  }catch(_){ }

  // 4) Búsquedas / filtros temporales
  try{
    const s1 = document.getElementById('customer-picker-search');
    if (s1) s1.value = '';
    const s2 = document.getElementById('customer-manage-search');
    if (s2) s2.value = '';
    const s3 = document.getElementById('summary-customer');
    if (s3) s3.value = '';
    const fe = document.getElementById('filtro-eventos');
    if (fe) fe.value = 'todos';
    const fg = document.getElementById('filtro-grupo');
    if (fg) fg.value = '';
  }catch(_){ }

  // 5) Cerrar modales/paneles que podrían quedar “colgados”
  try{ closeModalPOS('customer-picker-modal'); }catch(_){ }
  try{ closeModalPOS('customer-edit-modal'); }catch(_){ }
  try{ closeModalPOS('customer-merge-modal'); }catch(_){ }
  try{
    const panel = document.getElementById('customer-manage-panel');
    const btn = document.getElementById('btn-toggle-customer-manage');
    if (panel) panel.style.display = 'none';
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }catch(_){ }

  // 7) Sección: si estaba en histórico, volver a modo operativo (solo UI)
  try{
    if (typeof isPettyHistoryMode === 'function' && isPettyHistoryMode()) exitPettyHistoryMode();
  }catch(_){ }

  // 8) Extras: formulario en limpio (sin tocar extras del evento)
  try{ resetExtraFormPOS(); }catch(_){ }
}


function persistCustomerStickyStatePOS(){
  try{
    A33Storage.setItem(CUSTOMER_STICKY_KEY, isCustomerStickyPOS() ? '1' : '0');
  }catch(_){ }
}

function persistCustomerLastPOS(val){
  try{ A33Storage.setItem(CUSTOMER_LAST_KEY, sanitizeCustomerDisplayPOS(val || '')); }catch(_){ }
}

function resolveCustomerIdForSalePOS(customerName, uiHintId){
  const name = sanitizeCustomerDisplayPOS(customerName);
  if (!name) return { id: null, displayName: '', isNew: false };

  const catalog = loadCustomerCatalogPOS();
  const resolver = buildCustomerResolverPOS(catalog);
  const isSelectable = (finalId)=>{
    const fid = finalId ? String(finalId).trim() : '';
    if (!fid) return false;
    const c = resolver.byId.get(fid);
    return !!(c && c.isActive !== false && !c.mergedIntoId);
  };

  // 1) Hint de UI: si existe el ID, lo respetamos solo si el destino final está activo.
  if (uiHintId){
    const hid = String(uiHintId).trim();
    if (hid && resolver.byId.has(hid)){
      const finalId = resolver.resolveFinalId(hid);
      if (isSelectable(finalId)){
        const displayName = resolver.getDisplayName(finalId) || name;
        return { id: String(finalId), displayName, isNew: false };
      }
    }
  }

  // 2) Match robusto por nombre (name / aliases / nameHistory / clientes fusionados), pero solo para clientes activos.
  const finalId2 = resolver.matchNameToFinalId(name);
  if (finalId2 && isSelectable(finalId2)){
    const displayName = resolver.getDisplayName(finalId2) || name;
    return { id: String(finalId2), displayName, isNew: false };
  }

  // Etapa 2/3: POS no crea clientes desde Vender. Si no existe/está inactivo, se registra sin ID.
  return { id: null, displayName: '', isNew: false };
}

// Venta sin cliente (Etapa 1): confirmación antes de registrar
function isNoCustomerSelectedForSalePOS(){
  const name = getCustomerNameFromUI_POS();
  const hint = getCustomerIdHintFromUI_POS();
  const resolved = resolveCustomerIdForSalePOS(name, hint);
  return !(resolved && resolved.id);
}

function confirmProceedSaleWithoutCustomerPOS(){
  if (!isNoCustomerSelectedForSalePOS()) return true;
  return confirm('No hay cliente seleccionado. ¿Registrar esta venta sin cliente?');
}

function ensureCustomerInCatalogPOS(name, preferredId){
  const n = sanitizeCustomerDisplayPOS(name);
  if (!n) return { ok:false, id:null };

  const norm = normalizeCustomerKeyPOS(n);
  if (!norm) return { ok:false, id:null };

  const list = loadCustomerCatalogPOS();
  const resolver = buildCustomerResolverPOS(list);
  const matchFinal = resolver.matchNameToFinalId(n);

  if (matchFinal){
    const existing = resolver.byId.get(String(matchFinal));
    if (existing){
      // Reactivar si estaba desactivado
      if (existing.isActive === false){
        existing.isActive = true;
        existing.updatedAt = Date.now();
      }

      // Si el usuario escribió una variante (alias), la guardamos como alias del ID final
      const kTyped = normalizeCustomerKeyPOS(n);
      const kMain = normalizeCustomerKeyPOS(existing.name);
      if (kTyped && kMain && kTyped !== kMain){
        if (!Array.isArray(existing.aliases)) existing.aliases = [];
        if (!existing.aliases.some(a => normalizeCustomerKeyPOS(a) === kTyped)){
          existing.aliases.push(n);
          existing.updatedAt = Date.now();
        }
      }

      const sorted = sortCustomerObjectsAZ_POS(list);
      saveCustomerCatalogPOS(sorted);
      syncDisabledLegacyFromCatalogPOS(sorted);
      return { ok:true, id: String(existing.id) };
    }
  }

  const existingIds = new Set(list.map(c => c && c.id).filter(Boolean).map(String));
  let id = preferredId ? String(preferredId) : '';
  if (!id || existingIds.has(id)){
    id = generateCustomerIdPOS(existingIds);
  }
  const obj = {
    id,
    name: n,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: null,
    normalizedName: norm,
    aliases: [],
    nameHistory: [],
    mergedIntoId: null,
    mergedAt: null,
    mergeReason: '',
    mergeHistory: []
  };

  list.push(obj);
  const sorted = sortCustomerObjectsAZ_POS(list);
  saveCustomerCatalogPOS(sorted);
  syncDisabledLegacyFromCatalogPOS(sorted);
  refreshCustomerUI_POS();

  return { ok:true, id };
}

function getActiveCustomersPOS(){
  const all = loadCustomerCatalogPOS();
  return dedupeSelectableCustomersPOS(all);
}

function addCustomerToCatalogPOS(name, preferredId){
  const n = sanitizeCustomerDisplayPOS(name);
  if (!n) return { ok:false, reason:'empty', id:null };

  const norm = normalizeCustomerKeyPOS(n);
  if (!norm) return { ok:false, reason:'empty', id:null };

  const list = loadCustomerCatalogPOS();
  const resolver = buildCustomerResolverPOS(list);
  const matchFinal = resolver.matchNameToFinalId(n);
  if (matchFinal) {
    const ex = resolver.byId.get(String(matchFinal));
    return { ok:false, reason:'exists', id: (ex && ex.id) ? String(ex.id) : String(matchFinal) };
  }

  const existingIds = new Set(list.map(c => c && c.id).filter(Boolean).map(String));
  let id = preferredId ? String(preferredId) : '';
  if (!id || existingIds.has(id)){
    id = generateCustomerIdPOS(existingIds);
  }

  list.push({
    id,
    name: n,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: null,
    normalizedName: norm,
    aliases: [],
    nameHistory: [],
    mergedIntoId: null,
    mergedAt: null,
    mergeReason: '',
    mergeHistory: []
  });

  const sorted = sortCustomerObjectsAZ_POS(list);
  saveCustomerCatalogPOS(sorted);
  syncDisabledLegacyFromCatalogPOS(sorted);
  refreshCustomerUI_POS();

  return { ok:true, id };
}

function setCustomerActiveByIdPOS(id, isActive){
  const cid = (id != null) ? String(id) : '';
  if (!cid) return;

  const list = loadCustomerCatalogPOS();
  const c = list.find(x => x && String(x.id) === cid);
  if (!c) return;

  // ABS: un cliente fusionado (fuente) no se reactiva ni se toca
  if (c.mergedIntoId){
    toast('Este cliente está fusionado. Administra el destino final.');
    return;
  }

  c.isActive = !!isActive;
  c.updatedAt = Date.now();
  const sorted = sortCustomerObjectsAZ_POS(list);
  saveCustomerCatalogPOS(sorted);
  syncDisabledLegacyFromCatalogPOS(sorted);
  refreshCustomerUI_POS();
}

function editCustomerNamePOS(customerId, newName, reason){
  const cid = (customerId != null) ? String(customerId).trim() : '';
  const nn = sanitizeCustomerDisplayPOS(newName || '');
  if (!cid || !nn) return { ok:false, reason:'empty' };

  const list = loadCustomerCatalogPOS();
  const resolver = buildCustomerResolverPOS(list);
  const c = resolver.byId.get(cid);
  if (!c) return { ok:false, reason:'not_found' };

  // Solo se edita el ID final (no la fuente fusionada)
  if (c.mergedIntoId) return { ok:false, reason:'merged_source' };

  const newNorm = normalizeCustomerKeyPOS(nn);
  if (!newNorm) return { ok:false, reason:'empty' };

  // Evitar renombres que choquen con otro cliente (mejor: fusionar)
  const matchFinal = resolver.matchNameToFinalId(nn);
  if (matchFinal && String(matchFinal) !== String(cid)){
    return { ok:false, reason:'name_conflict', conflictId: String(matchFinal) };
  }

  const oldName = sanitizeCustomerDisplayPOS(c.name || '');
  if (oldName && normalizeCustomerKeyPOS(oldName) === newNorm){
    return { ok:true, id: cid, noChange:true };
  }

  if (!Array.isArray(c.nameHistory)) c.nameHistory = [];
  c.nameHistory.push({
    from: oldName,
    to: nn,
    at: Date.now(),
    reason: sanitizeCustomerDisplayPOS(reason || '')
  });

  // Guardar el nombre viejo también como alias para resolver escritura manual
  if (oldName){
    if (!Array.isArray(c.aliases)) c.aliases = [];
    const kOld = normalizeCustomerKeyPOS(oldName);
    if (kOld && !c.aliases.some(a => normalizeCustomerKeyPOS(a) === kOld)){
      c.aliases.push(oldName);
    }
  }

  c.name = nn;
  c.normalizedName = newNorm;
  c.updatedAt = Date.now();

  const sorted = sortCustomerObjectsAZ_POS(list);
  saveCustomerCatalogPOS(sorted);
  syncDisabledLegacyFromCatalogPOS(sorted);
  refreshCustomerUI_POS();

  // Si estaba seleccionado en la venta, refrescar el input
  const inp = document.getElementById('sale-customer');
  if (inp && inp.dataset && String(inp.dataset.customerId||'') === cid){
    setCustomerSelectionUI_POS({ id: cid, name: nn });
    if (isCustomerStickyPOS()) persistCustomerLastPOS(nn);
  }

  return { ok:true, id: cid };
}

function mergeCustomersPOS(sourceId, destId, reason){
  const sid = (sourceId != null) ? String(sourceId).trim() : '';
  const did = (destId != null) ? String(destId).trim() : '';
  if (!sid || !did) return { ok:false, reason:'empty' };
  if (sid === did) return { ok:false, reason:'same' };

  const list = loadCustomerCatalogPOS();
  const resolver = buildCustomerResolverPOS(list);
  const source = resolver.byId.get(sid);
  const destRaw = resolver.byId.get(did);
  if (!source || !destRaw) return { ok:false, reason:'not_found' };

  // Bloqueos
  if (source.mergedIntoId) return { ok:false, reason:'source_already_merged' };
  if (destRaw.isActive === false) return { ok:false, reason:'dest_inactive' };
  if (destRaw.mergedIntoId) return { ok:false, reason:'dest_is_source' };

  const destFinalId = resolver.resolveFinalId(did);
  if (!destFinalId) return { ok:false, reason:'not_found' };
  if (String(destFinalId) === sid) return { ok:false, reason:'same' };

  const dest = resolver.byId.get(String(destFinalId));
  if (!dest) return { ok:false, reason:'not_found' };
  if (dest.isActive === false) return { ok:false, reason:'dest_inactive' };
  if (dest.mergedIntoId) return { ok:false, reason:'dest_is_source' };

  const now = Date.now();
  const mergeReason = sanitizeCustomerDisplayPOS(reason || '');

  // Fuente
  source.isActive = false;
  source.mergedIntoId = String(destFinalId);
  source.mergedAt = now;
  source.mergeReason = mergeReason;
  source.updatedAt = now;

  // Destino
  if (!Array.isArray(dest.mergeHistory)) dest.mergeHistory = [];
  dest.mergeHistory.push({ fromId: String(source.id), fromName: sanitizeCustomerDisplayPOS(source.name||''), at: now, reason: mergeReason });
  if (!Array.isArray(dest.aliases)) dest.aliases = [];

  const pushAlias = (txt)=>{
    const v = sanitizeCustomerDisplayPOS(txt||'');
    if (!v) return;
    const k = normalizeCustomerKeyPOS(v);
    if (!k) return;
    if (!dest.aliases.some(a => normalizeCustomerKeyPOS(a) === k)) dest.aliases.push(v);
  };

  // Agregar nombre de la fuente + sus aliases + su historial
  pushAlias(source.name);
  if (Array.isArray(source.aliases)) for (const a of source.aliases) pushAlias(a);
  if (Array.isArray(source.nameHistory)){
    for (const h of source.nameHistory){
      if (h && h.from) pushAlias(h.from);
      if (h && h.to) pushAlias(h.to);
    }
  }

  dest.updatedAt = now;

  const sorted = sortCustomerObjectsAZ_POS(list);
  saveCustomerCatalogPOS(sorted);
  syncDisabledLegacyFromCatalogPOS(sorted);
  refreshCustomerUI_POS();

  // Si el cliente seleccionado era la fuente, saltamos al destino
  const inp = document.getElementById('sale-customer');
  if (inp && inp.dataset && String(inp.dataset.customerId||'') === sid){
    setCustomerSelectionUI_POS({ id: String(destFinalId), name: sanitizeCustomerDisplayPOS(dest.name||'') });
    if (isCustomerStickyPOS()) persistCustomerLastPOS(dest.name);
  }

  return { ok:true, destId: String(destFinalId) };
}

function isCustomerDisabledKeyPOS(normKey){
  if (!normKey) return false;
  const set = loadCustomerDisabledSetPOS();
  return set.has(normKey);
}

function isCustomerPickerOpenPOS(){
  const modal = document.getElementById('customer-picker-modal');
  return !!(modal && modal.style.display === 'flex');
}

function closeCustomerPickerPOS(){
  const modal = document.getElementById('customer-picker-modal');
  if (modal) modal.style.display = 'none';
  // Si el picker fue abierto con callback (ej. Resumen), lo limpiamos al cerrar.
  try{ window.__A33_CUSTOMER_PICKER_ONSELECT = null; }catch(_){ }
}

function renderCustomerPickerListPOS(){
  const wrap = document.getElementById('customer-picker-list');
  const search = document.getElementById('customer-picker-search');
  const count = document.getElementById('customer-picker-count');
  if (!wrap) return;

  const q = normalizeCustomerKeyPOS(search ? search.value : '');
  const active = getActiveCustomersPOS();
  const filtered = q ? active.filter(c => (c && c.normalizedName && c.normalizedName.includes(q)) || normalizeCustomerKeyPOS(c && c.name).includes(q)) : active;

  wrap.innerHTML = '';
  if (!filtered.length){
    wrap.innerHTML = '<div class="muted">Sin resultados</div>';
    if (count) count.textContent = '0';
    return;
  }

  for (const c of filtered){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'customer-picker-item';
    btn.textContent = c.name;
    btn.addEventListener('click', ()=>{
      const cb = (typeof window !== 'undefined') ? window.__A33_CUSTOMER_PICKER_ONSELECT : null;
      if (typeof cb === 'function'){
        try{ cb(c); }catch(err){ console.warn('customer picker onSelect error', err); }
        try{ window.__A33_CUSTOMER_PICKER_ONSELECT = null; }catch(_){ }
        closeCustomerPickerPOS();
        return;
      }

      setCustomerSelectionUI_POS(c);
      // El último cliente se guarda siempre; el modo pegajoso decide si se limpia tras la venta.
      persistCustomerLastPOS(c.name);
      closeCustomerPickerPOS();
    });
    wrap.appendChild(btn);
  }

  if (count) count.textContent = filtered.length + ' cliente' + (filtered.length === 1 ? '' : 's');
}

function openCustomerPickerPOS(onSelect){
  const modal = document.getElementById('customer-picker-modal');
  if (!modal) return;

  // Permite reutilizar el mismo picker en otros contextos (ej. Resumen)
  try{ window.__A33_CUSTOMER_PICKER_ONSELECT = (typeof onSelect === 'function') ? onSelect : null; }catch(_){ }

  // reset búsqueda
  const search = document.getElementById('customer-picker-search');
  if (search) search.value = '';

  renderCustomerPickerListPOS();
  modal.style.display = 'flex';

  setTimeout(()=>{ try{ document.getElementById('customer-picker-search')?.focus(); }catch(_){ } }, 40);
}

function renderCustomerManageListPOS(){
  const listEl = document.getElementById('customer-manage-list');
  if (!listEl) return;

  applyCustomerManageUIStatePOS();

  const searchEl = document.getElementById('customer-manage-search');
  const countEl = document.getElementById('customer-manage-count');
  const q = normalizeCustomerKeyPOS(searchEl ? searchEl.value : '');

  const filter = getCustomerManageFilterPOS();
  let items = loadCustomerCatalogPOS();
  if (filter === 'active') items = items.filter(c => c && c.isActive !== false);
  items = sortCustomerObjectsAZ_POS(items);

  if (q) items = items.filter(c => c && c.normalizedName && c.normalizedName.includes(q));

  // Conteo
  try{
    if (countEl){
      const label = (filter === 'active') ? 'Activos' : 'Todos';
      countEl.textContent = label + ': ' + items.length;
    }
  }catch(_){ }

  listEl.innerHTML = '';

  if (!items.length){
    listEl.innerHTML = '<div class="muted">Sin resultados.</div>';
    return;
  }

  const makeRow = (c)=>{
    const isOff = (c.isActive === false);
    const isMerged = !!(c && c.mergedIntoId);

    const row = document.createElement('div');
    row.className = 'customer-manage-item';

    const left = document.createElement('div');
    left.className = 'customer-manage-meta';

    const nm = document.createElement('div');
    nm.className = 'customer-manage-name';
    nm.textContent = c.name;

    const badge = document.createElement('span');
    badge.className = 'badge ' + (isOff ? 'badge-off' : 'badge-on');
    badge.textContent = isOff ? 'Desactivado' : 'Activo';

    left.appendChild(nm);
    left.appendChild(badge);

    if (isMerged){
      const b2 = document.createElement('span');
      b2.className = 'badge badge-off';
      b2.textContent = 'Fusionado';
      left.appendChild(b2);
    }

    const actions = document.createElement('div');
    actions.className = 'customer-manage-item-actions';

    const btnEdit = document.createElement('button');
    btnEdit.type = 'button';
    btnEdit.className = 'btn-secondary btn-pill btn-pill-mini' + (isMerged ? ' btn-disabled' : '');
    btnEdit.textContent = 'Editar';
    if (!isMerged){
      btnEdit.addEventListener('click', ()=> openCustomerEditModalPOS(String(c.id)));
    } else {
      btnEdit.disabled = true;
    }

    const btnMerge = document.createElement('button');
    btnMerge.type = 'button';
    btnMerge.className = 'btn-outline btn-pill btn-pill-mini' + (isMerged ? ' btn-disabled' : '');
    btnMerge.textContent = 'Fusionar';
    if (!isMerged){
      btnMerge.addEventListener('click', ()=> openCustomerMergeModalPOS({ sourceId: String(c.id) }));
    } else {
      btnMerge.disabled = true;
    }

    const btnToggle = document.createElement('button');
    btnToggle.type = 'button';
    btnToggle.className = (isOff ? 'btn-ok' : 'btn-warn') + ' btn-pill btn-pill-mini' + (isMerged ? ' btn-disabled' : '');
    btnToggle.textContent = isOff ? 'Reactivar' : 'Desactivar';
    if (!isMerged){
      btnToggle.addEventListener('click', ()=> setCustomerActiveByIdPOS(c.id, isOff));
    } else {
      btnToggle.disabled = true;
    }

    actions.appendChild(btnEdit);
    actions.appendChild(btnMerge);
    actions.appendChild(btnToggle);

    row.appendChild(left);
    row.appendChild(actions);
    return row;
  };

  // Si hay búsqueda activa, mostramos lista plana (Resultados)
  if (q){
    const head = document.createElement('div');
    head.className = 'customer-manage-results-head';
    const t = document.createElement('div');
    t.className = 'customer-manage-results-title';
    t.textContent = 'Resultados';
    const t2 = document.createElement('div');
    t2.className = 'muted';
    t2.textContent = String(items.length);
    head.appendChild(t);
    head.appendChild(t2);
    listEl.appendChild(head);

    for (const c of items){
      listEl.appendChild(makeRow(c));
    }
    return;
  }

  // Acordeón por letra
  const groups = {};
  for (const c of items){
    const letter = getCustomerGroupLetterPOS(c && c.name);
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push(c);
  }

  const letters = Object.keys(groups)
    .sort((a,b)=>{
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });

  let openMap = loadCustomerManageOpenMapPOS();
  const hasAny = openMap && typeof openMap === 'object' && Object.keys(openMap).length > 0;
  if (!hasAny){
    // Primer uso: abrir la primera letra para que no se vea “vacío”
    if (letters.length){
      openMap = {};
      openMap[letters[0]] = true;
      saveCustomerManageOpenMapPOS(openMap);
    }
  }

  for (const letter of letters){
    const arr = groups[letter] || [];
    if (!arr.length) continue;

    const isOpen = !!openMap[letter];

    const g = document.createElement('div');
    g.className = 'customer-manage-group';

    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'customer-manage-group-header';
    h.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    const left = document.createElement('div');
    left.className = 'customer-manage-group-left';

    const l = document.createElement('div');
    l.className = 'customer-manage-group-letter';
    l.textContent = letter;

    const cnt = document.createElement('div');
    cnt.className = 'customer-manage-group-count';
    cnt.textContent = String(arr.length);

    left.appendChild(l);
    left.appendChild(cnt);

    const ch = document.createElement('div');
    ch.className = 'customer-manage-group-chevron';
    ch.textContent = isOpen ? '▾' : '▸';

    h.appendChild(left);
    h.appendChild(ch);

    h.addEventListener('click', ()=>{
      const map = loadCustomerManageOpenMapPOS();
      map[letter] = !map[letter];
      saveCustomerManageOpenMapPOS(map);
      renderCustomerManageListPOS();
    });

    g.appendChild(h);

    if (isOpen){
      const body = document.createElement('div');
      body.className = 'customer-manage-group-body';
      for (const c of arr){
        body.appendChild(makeRow(c));
      }
      g.appendChild(body);
    }

    listEl.appendChild(g);
  }
}

function refreshCustomerUI_POS(){
  // Migración suave: al refrescar UI aseguramos que el catálogo esté en formato objeto.
  // Etapa 2/3: POS solo selecciona clientes; la administración vive en Catálogos.
  loadCustomerCatalogPOS();

  // Etapa 3/3: si el cliente seleccionado fue desactivado/invalidado fuera del POS, se limpia sin tocar pagos/productos/totales.
  try{ validateCurrentCustomerSelectionPOS({ updateName: true }); }catch(_){ }

  // Si el picker está abierto, re-render para respetar activos/búsqueda.
  if (isCustomerPickerOpenPOS()) renderCustomerPickerListPOS();
}

function toggleCustomerManagePanelPOS(){
  const panel = document.getElementById('customer-manage-panel');
  const btn = document.getElementById('btn-toggle-customer-manage');
  if (!panel || !btn) return;

  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  btn.setAttribute('aria-expanded', open ? 'false' : 'true');

  if (!open){
    renderCustomerManageListPOS();
    setTimeout(()=>{ try{ document.getElementById('customer-add-name')?.focus(); }catch(_){ } }, 40);
  }
}

function setupCustomerPickerModalPOS(){
  const modal = document.getElementById('customer-picker-modal');
  if (!modal) return;

  const closeBtn = document.getElementById('customer-picker-close');
  if (closeBtn){
    closeBtn.addEventListener('click', closeCustomerPickerPOS);
  }

  // click/tap fuera
  modal.addEventListener('click', (e)=>{
    if (e.target === modal) closeCustomerPickerPOS();
  });

  const search = document.getElementById('customer-picker-search');
  if (search){
    search.addEventListener('input', ()=> renderCustomerPickerListPOS());
  }

  // Escape
  document.addEventListener('keydown', (e)=>{
    if (e.key !== 'Escape') return;
    if (isCustomerPickerOpenPOS()) closeCustomerPickerPOS();
    if (isCustomerEditOpenPOS()) closeCustomerEditModalPOS();
    if (isCustomerMergeOpenPOS()) closeCustomerMergeModalPOS();
  });
}

function isCustomerEditOpenPOS(){
  const modal = document.getElementById('customer-edit-modal');
  return !!(modal && modal.style.display === 'flex');
}

function closeCustomerEditModalPOS(){
  const modal = document.getElementById('customer-edit-modal');
  if (modal) modal.style.display = 'none';
}

function openCustomerEditModalPOS(customerId){
  const modal = document.getElementById('customer-edit-modal');
  if (!modal) return;

  const list = loadCustomerCatalogPOS();
  const resolver = buildCustomerResolverPOS(list);
  const c = resolver.byId.get(String(customerId||'').trim());
  if (!c){ toast('Cliente no encontrado'); return; }
  if (c.mergedIntoId){ toast('Este cliente está fusionado. Edita el destino.'); return; }

  modal.dataset.editId = String(c.id);
  const cur = document.getElementById('customer-edit-current');
  if (cur) cur.textContent = sanitizeCustomerDisplayPOS(c.name||'');
  const inp = document.getElementById('customer-edit-name');
  if (inp) inp.value = sanitizeCustomerDisplayPOS(c.name||'');
  const rsn = document.getElementById('customer-edit-reason');
  if (rsn) rsn.value = '';
  const msg = document.getElementById('customer-edit-msg');
  if (msg) msg.textContent = '';

  modal.style.display = 'flex';
  setTimeout(()=>{ try{ inp?.focus(); inp?.select(); }catch(_){ } }, 60);
}

function setupCustomerEditModalPOS(){
  const modal = document.getElementById('customer-edit-modal');
  if (!modal) return;

  const closeBtn = document.getElementById('customer-edit-close');
  if (closeBtn) closeBtn.addEventListener('click', closeCustomerEditModalPOS);

  modal.addEventListener('click', (e)=>{ if (e.target === modal) closeCustomerEditModalPOS(); });

  const btn = document.getElementById('customer-edit-save');
  if (btn){
    btn.addEventListener('click', ()=>{
      const id = String(modal.dataset.editId || '').trim();
      const nn = document.getElementById('customer-edit-name')?.value || '';
      const reason = document.getElementById('customer-edit-reason')?.value || '';
      const msg = document.getElementById('customer-edit-msg');
      const r = editCustomerNamePOS(id, nn, reason);
      if (!r || !r.ok){
        if (r && r.reason === 'name_conflict'){
          if (msg) msg.textContent = 'Ese nombre ya existe. Mejor usa Fusionar.';
          return;
        }
        if (msg) msg.textContent = 'No se pudo editar.';
        return;
      }
      toast(r.noChange ? 'Sin cambios.' : 'Cliente editado.');
      closeCustomerEditModalPOS();
      renderCustomerManageListPOS();
      if (isCustomerPickerOpenPOS()) renderCustomerPickerListPOS();
    });
  }

  const cancelBtn = document.getElementById('customer-edit-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeCustomerEditModalPOS);
}

function isCustomerMergeOpenPOS(){
  const modal = document.getElementById('customer-merge-modal');
  return !!(modal && modal.style.display === 'flex');
}

function closeCustomerMergeModalPOS(){
  const modal = document.getElementById('customer-merge-modal');
  if (modal) modal.style.display = 'none';
}

function fillCustomerMergeSelectsPOS(sourceId){
  const srcSel = document.getElementById('customer-merge-source');
  const dstSel = document.getElementById('customer-merge-dest');
  if (!srcSel || !dstSel) return;

  const list = loadCustomerCatalogPOS();
  const resolver = buildCustomerResolverPOS(list);

  // Fuente: cualquier cliente que NO sea ya fuente fusionada
  const sources = list
    .filter(c => c && !c.mergedIntoId)
    .map(c => ({ id: String(c.id), name: sanitizeCustomerDisplayPOS(c.name||''), isActive: c.isActive !== false }));

  // Destino: solo activos y no fusionados
  const dests = list
    .filter(c => c && c.isActive !== false && !c.mergedIntoId)
    .map(c => ({ id: String(c.id), name: sanitizeCustomerDisplayPOS(c.name||'') }));

  const sortByName = (a,b)=> (a.name||'').localeCompare(b.name||'');
  sources.sort(sortByName);
  dests.sort(sortByName);

  srcSel.innerHTML = '';
  dstSel.innerHTML = '';

  for (const s of sources){
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name + (s.isActive ? '' : ' (desactivado)');
    srcSel.appendChild(opt);
  }
  for (const d of dests){
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    dstSel.appendChild(opt);
  }

  // Preselección
  const sid = String(sourceId||'').trim();
  if (sid && sources.some(s => s.id === sid)) srcSel.value = sid;

  // Si destino queda igual a fuente, movemos destino al primer distinto
  if (dstSel.value === srcSel.value){
    const firstOk = dests.find(d => d.id !== srcSel.value);
    if (firstOk) dstSel.value = firstOk.id;
  }

  // En caso de que el usuario escoja una fuente, evitamos que destino sea el mismo
  const sync = ()=>{
    if (dstSel.value === srcSel.value){
      const firstOk2 = dests.find(d => d.id !== srcSel.value);
      if (firstOk2) dstSel.value = firstOk2.id;
    }
  };
  srcSel.onchange = sync;
  dstSel.onchange = sync;
}

function openCustomerMergeModalPOS(opts){
  const modal = document.getElementById('customer-merge-modal');
  if (!modal) return;
  const sourceId = opts && opts.sourceId ? String(opts.sourceId) : '';
  modal.dataset.sourcePreset = sourceId || '';

  fillCustomerMergeSelectsPOS(sourceId);

  const chk = document.getElementById('customer-merge-confirm');
  if (chk) chk.checked = false;
  const rsn = document.getElementById('customer-merge-reason');
  if (rsn) rsn.value = '';
  const msg = document.getElementById('customer-merge-msg');
  if (msg) msg.textContent = '';

  modal.style.display = 'flex';
  setTimeout(()=>{ try{ document.getElementById('customer-merge-source')?.focus(); }catch(_){ } }, 60);
}

function setupCustomerMergeModalPOS(){
  const modal = document.getElementById('customer-merge-modal');
  if (!modal) return;

  const closeBtn = document.getElementById('customer-merge-close');
  if (closeBtn) closeBtn.addEventListener('click', closeCustomerMergeModalPOS);

  modal.addEventListener('click', (e)=>{ if (e.target === modal) closeCustomerMergeModalPOS(); });

  const confirmChk = document.getElementById('customer-merge-confirm');
  const doBtn = document.getElementById('customer-merge-run');
  const gate = ()=>{
    if (doBtn) doBtn.disabled = !(confirmChk && confirmChk.checked);
  };
  if (confirmChk){
    confirmChk.addEventListener('change', gate);
  }
  gate();

  if (doBtn){
    doBtn.addEventListener('click', ()=>{
      const srcId = document.getElementById('customer-merge-source')?.value || '';
      const dstId = document.getElementById('customer-merge-dest')?.value || '';
      const reason = document.getElementById('customer-merge-reason')?.value || '';
      const msg = document.getElementById('customer-merge-msg');

      const r = mergeCustomersPOS(srcId, dstId, reason);
      if (!r || !r.ok){
        const why = (r && r.reason) ? r.reason : 'error';
        let human = 'No se pudo fusionar.';
        if (why === 'source_already_merged') human = 'La fuente ya está fusionada.';
        else if (why === 'dest_inactive') human = 'El destino no puede estar desactivado.';
        else if (why === 'same') human = 'No puedes fusionar un cliente consigo mismo.';
        else if (why === 'dest_is_source') human = 'El destino seleccionado no es válido (está fusionado).';
        if (msg) msg.textContent = human;
        return;
      }

      toast('Fusión aplicada. Historia intacta.');
      closeCustomerMergeModalPOS();
      renderCustomerManageListPOS();
      if (isCustomerPickerOpenPOS()) renderCustomerPickerListPOS();
    });
  }

  const cancelBtn = document.getElementById('customer-merge-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeCustomerMergeModalPOS);
}

function initCustomerUXPOS(){
  const inp = document.getElementById('sale-customer');
  const sticky = document.getElementById('sale-customer-sticky');
  const clearBtn = document.getElementById('btn-clear-customer');
  const pickBtn = document.getElementById('btn-pick-customer');

  if (!inp || !sticky) return;

  // Etapa 2/3: POS solo selecciona clientes activos; no administra ni crea clientes.
  try{ inp.setAttribute('readonly', 'readonly'); inp.setAttribute('aria-readonly', 'true'); }catch(_){ }
  setupCustomerPickerModalPOS();
  refreshCustomerUI_POS();

  // Estado pegajoso + último cliente: restaurar solo si todavía existe y está activo.
  const stickyOn = (A33Storage.getItem(CUSTOMER_STICKY_KEY) === '1');
  sticky.checked = stickyOn;
  if (stickyOn){
    const last = A33Storage.getItem(CUSTOMER_LAST_KEY) || '';
    if (last){
      const r = resolveCustomerIdForSalePOS(last, null);
      if (r && r.id){
        setCustomerSelectionUI_POS({ id: String(r.id), name: r.displayName || last });
      } else {
        clearCustomerSelectionUI_POS();
        persistCustomerLastPOS('');
      }
    }
  }

  sticky.addEventListener('change', ()=>{
    persistCustomerStickyStatePOS();
    if (sticky.checked){
      persistCustomerLastPOS(inp.value || '');
    }
  });

  // Defensa: si algo externo cambia el input, solo se acepta si resuelve a cliente activo.
  inp.addEventListener('input', ()=>{
    const raw = sanitizeCustomerDisplayPOS(inp.value || '');
    const r = resolveCustomerIdForSalePOS(raw, null);
    if (r && r.id){
      setCustomerSelectionUI_POS({ id: String(r.id), name: r.displayName || raw });
      if (isCustomerStickyPOS()) persistCustomerLastPOS(r.displayName || raw);
    } else {
      if (inp.dataset) delete inp.dataset.customerId;
    }
  });

  inp.addEventListener('blur', ()=>{
    const raw = sanitizeCustomerDisplayPOS(inp.value || '');
    if (!raw) return;
    const r = resolveCustomerIdForSalePOS(raw, getCustomerIdHintFromUI_POS());
    if (r && r.id){
      setCustomerSelectionUI_POS({ id: String(r.id), name: r.displayName || raw });
      if (isCustomerStickyPOS()) persistCustomerLastPOS(r.displayName || raw);
    } else {
      clearCustomerSelectionUI_POS();
      persistCustomerLastPOS('');
    }
  });

  if (clearBtn){
    clearBtn.addEventListener('click', ()=>{
      clearCustomerSelectionUI_POS();
      persistCustomerLastPOS('');
      try{ pickBtn ? pickBtn.focus() : inp.focus(); }catch(_){ }
    });
  }

  if (pickBtn){
    pickBtn.addEventListener('click', ()=> openCustomerPickerPOS());
  }

  // Catálogos vive fuera de POS: si otra pantalla cambia clientes, POS se auto-blinda.
  try{
    window.addEventListener('storage', (ev)=>{
      if (!ev || ev.key === CUSTOMER_CATALOG_KEY || ev.key === CUSTOMER_DISABLED_KEY){
        refreshCustomerUI_POS();
      }
    });
  }catch(_){ }
}

function afterSaleCustomerHousekeepingPOS(customerName, customerId){
  const n = sanitizeCustomerDisplayPOS(customerName);
  const resolved = resolveCustomerIdForSalePOS(n, customerId || getCustomerIdHintFromUI_POS());

  // Etapa 3/3: pegajoso seguro. Si el cliente ya no está activo, vuelve a cliente por defecto sin tocar pago/productos/extras/totales.
  if (!(resolved && resolved.id)){
    persistCustomerLastPOS('');
    clearCustomerSelectionUI_POS();
    return;
  }

  const displayName = resolved.displayName || n;
  persistCustomerLastPOS(displayName);

  if (isCustomerStickyPOS()){
    setCustomerSelectionUI_POS({ id: String(resolved.id), name: displayName });
  } else {
    clearCustomerSelectionUI_POS();
  }
}


function getLastGroupName() {
  try {
    return A33Storage.getItem(LAST_GROUP_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setLastGroupName(name) {
  try {
    A33Storage.setItem(LAST_GROUP_KEY, name || '');
  } catch (e) {
    console.warn('No se pudo guardar último grupo usado', e);
  }
}

function getHiddenGroups() {
  try {
    const raw = A33Storage.getItem(HIDDEN_GROUPS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('No se pudieron leer grupos ocultos', e);
    return [];
  }
}

function setHiddenGroups(list) {
  try {
    const clean = Array.from(new Set((list || []).filter(Boolean)));
    A33Storage.setItem(HIDDEN_GROUPS_KEY, JSON.stringify(clean));
  } catch (e) {
    console.warn('No se pudieron guardar grupos ocultos', e);
  }
}

// --- Evento Maestro / Grupos: catálogo persistente (nombres + orden)
function readGroupCatalogPOS(){
  try{
    const raw = A33Storage.getItem(GROUP_CATALOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = new Set();
    for (const it of arr){
      const g = String(it || '').trim();
      if (!g || seen.has(g)) continue;
      out.push(g);
      seen.add(g);
    }
    return out;
  }catch(_){
    return [];
  }
}

function writeGroupCatalogPOS(list){
  try{
    const out = [];
    const seen = new Set();
    for (const it of (list || [])){
      const g = String(it || '').trim();
      if (!g || seen.has(g)) continue;
      out.push(g);
      seen.add(g);
    }
    A33Storage.setItem(GROUP_CATALOG_KEY, JSON.stringify(out));
    return out;
  }catch(e){
    console.warn('No se pudo guardar el catálogo de grupos', e);
    return readGroupCatalogPOS();
  }
}

function deriveGroupCatalogFromEventsPOS(evs){
  const events = Array.isArray(evs) ? evs.slice() : [];
  // Orden conservador: por createdAt asc (o id), para aproximar “orden de creación/uso”.
  events.sort((a,b)=>{
    const aa = String(a && a.createdAt || '');
    const bb = String(b && b.createdAt || '');
    if (aa && bb && aa !== bb) return aa.localeCompare(bb);
    return (Number(a && a.id || 0) - Number(b && b.id || 0));
  });

  const out = [];
  const seen = new Set();
  for (const ev of events){
    const g = String(ev && ev.groupName || '').trim();
    if (!g || seen.has(g)) continue;
    out.push(g);
    seen.add(g);
  }
  return out;
}

function ensureGroupCatalogFromEventsPOS(evs){
  const current = readGroupCatalogPOS();
  const derived = deriveGroupCatalogFromEventsPOS(evs);
  // Si no existe catálogo, se inicializa con lo derivado.
  if (!current.length && derived.length){
    return writeGroupCatalogPOS(derived);
  }
  // Si ya existe, se mergea conservadoramente (append de nuevos).
  const merged = current.slice();
  const seen = new Set(merged);
  for (const g of derived){
    if (!seen.has(g)){
      merged.push(g);
      seen.add(g);
    }
  }
  return writeGroupCatalogPOS(merged);
}

function addGroupToCatalogPOS(name){
  const g = String(name || '').trim();
  if (!g || g === '__new__') return;
  const cur = readGroupCatalogPOS();
  if (cur.includes(g)) return;
  cur.push(g);
  writeGroupCatalogPOS(cur);
}

function snapshotGroupsPOS(){
  return {
    catalog: readGroupCatalogPOS(),
    hidden: getHiddenGroups(),
    last: getLastGroupName(),
  };
}

function restoreGroupsPOS(snap){
  if (!snap || typeof snap !== 'object') return;
  try{
    if (Array.isArray(snap.catalog)) writeGroupCatalogPOS(snap.catalog);
    if (Array.isArray(snap.hidden)) setHiddenGroups(snap.hidden);
    if (snap.last != null) setLastGroupName(String(snap.last || ''));
  }catch(_){ }
}



// --- Recuperación conservadora de grupos (Evento Maestro) si 'events' quedó vacío
function recoverGroupCatalogFromLocalStoragePOS(){
  // Regla: no inventar nada. Solo reusar lo que ya exista en localStorage.
  try{
    const cur = readGroupCatalogPOS();
    if (cur && cur.length) return { repaired:false, catalog:cur, reason:'catalog_ok' };

    const out = [];
    const seen = new Set();
    const push = (val)=>{
      const g = String(val || '').trim();
      if (!g || seen.has(g) || g === '__new__') return;
      out.push(g);
      seen.add(g);
    };

    // 1) Último grupo usado
    try{ push(getLastGroupName()); }catch(_){ }

    // 2) Grupos ocultos (preserva nombres aunque no aparezcan en el combo)
    try{
      const hidden = getHiddenGroups();
      if (Array.isArray(hidden)) hidden.forEach(push);
    }catch(_){ }

    // Helper lectura raw
    const readRaw = (k)=>{
      try{
        const raw = (window.A33Storage && typeof A33Storage.getItem === 'function')
          ? A33Storage.getItem(k)
          : localStorage.getItem(k);
        return raw || null;
      }catch(_){ return null; }
    };

    // 3) Keys legacy conocidas (si existieran)
    const legacyKeys = ['a33_pos_groupCatalog','a33_pos_groupCatalog_v0','a33_pos_groupsCatalog','a33_pos_groupsCatalog_v1'];
    for (const k of legacyKeys){
      const raw = readRaw(k);
      if (!raw) continue;
      try{
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) arr.forEach(push);
      }catch(_){ }
    }

    // 4) Escaneo liviano: keys que parezcan catálogo de grupos
    try{
      for (let i=0; i<localStorage.length; i++){
        const k = localStorage.key(i);
        if (!k) continue;
        if (k === GROUP_CATALOG_KEY) continue;
        if (!/group.*catalog/i.test(k)) continue;
        const raw = readRaw(k);
        if (!raw) continue;
        try{
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) arr.forEach(push);
        }catch(_){ }
      }
    }catch(_){ }

    if (out.length){
      const saved = writeGroupCatalogPOS(out);
      return { repaired:true, catalog:saved, reason:'recovered_from_localStorage' };
    }
    return { repaired:false, catalog:[], reason:'no_source' };
  }catch(err){
    console.warn('No se pudo recuperar catálogo de grupos', err);
    try{ return { repaired:false, catalog: readGroupCatalogPOS(), reason:'error' }; }catch(_){ return { repaired:false, catalog:[], reason:'error' }; }
  }
}

async function ensureGroupsAvailableAtStartupPOS(){
  if (!db) await openDB();

  let evs = [];
  try{ evs = await getAll('events'); }catch(_){ evs = []; }

  // Si hay eventos, asegurar catálogo (merge conservador)
  if (evs.length){
    try{ ensureGroupCatalogFromEventsPOS(evs); }catch(_){ }
    return { eventsCount: evs.length, groupsCount: readGroupCatalogPOS().length, repaired: false };
  }

  // Si no hay eventos, intentar recuperar catálogo mínimo desde localStorage
  const before = readGroupCatalogPOS();
  const res = recoverGroupCatalogFromLocalStoragePOS();
  const after = readGroupCatalogPOS();
  const repaired = !!(res && res.repaired) || (before.length === 0 && after.length > 0);
  if (repaired){
    console.info('POS: catálogo de grupos recuperado (events vacío)', { before: before.length, after: after.length, reason: (res && res.reason) || '' });
  }
  return { eventsCount: 0, groupsCount: after.length, repaired };
}
function normName(s){ return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }

const CANON_GALON_LABEL = 'Galón 3720 ml';
function normKeyPOS(s){ return normName(s).replace(/\s+/g,''); }
// Back-compat: algunos bloques usan norm(...)
function norm(s){ return normKeyPOS(s); }
function uiProductNamePOS(name){
  try{
    if (window.A33Presentations && typeof A33Presentations.canonicalizeProductName === 'function'){
      return A33Presentations.canonicalizeProductName(name);
    }
  }catch(_){ }
  const n = normName(name);
  if (!n) return String(name||'');
  if (n.includes('gal')) return CANON_GALON_LABEL;
  return String(name||'');
}
function uiTextPOS(text){
  try{
    if (window.A33Presentations && typeof A33Presentations.canonicalizeText === 'function'){
      return A33Presentations.canonicalizeText(text);
    }
  }catch(_){ }
  return String(text||'');
}

// Detectar clave de presentación (P/M/D/L/G) a partir del nombre de producto
function presKeyFromProductNamePOS(name){
  const n = normName(name);
  if (!n) return '';
  if (n.includes('pulso') && n.includes('250')) return 'P';
  if (n.includes('media') && n.includes('375')) return 'M';
  if (n.includes('djeba') && n.includes('750')) return 'D';
  if (n.includes('litro') && n.includes('1000')) return 'L';
  if ((n.includes('galon') || n.includes('galón')) && (n.includes('3750') || n.includes('3800'))) return 'G';
  // fallback por palabra (por si el nombre no incluye ml)
  if (n.includes('pulso')) return 'P';
  if (n.includes('media')) return 'M';
  if (n.includes('djeba')) return 'D';
  if (n.includes('litro')) return 'L';
  if (n.includes('galon') || n.includes('galón')) return 'G';
  return '';
}

const RECETAS_KEY = 'arcano33_recetas_v1';

const STORAGE_KEY_INVENTARIO = 'arcano33_inventario';

function invParseNumberPOS(value){
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}
function invCentralDefaultPOS(){
  return {
    liquids: {},
    bottles: {},
    finished: {},
    finishedByProductId: {},
  };
}
function invCentralNormalizePOS(data){
  const out = (data && typeof data === 'object') ? data : invCentralDefaultPOS();
  if (!out.liquids || typeof out.liquids !== 'object') out.liquids = {};
  if (!out.bottles || typeof out.bottles !== 'object') out.bottles = {};
  if (!out.finished || typeof out.finished !== 'object') out.finished = {};
  if (!out.finishedByProductId || typeof out.finishedByProductId !== 'object') out.finishedByProductId = {};

  Object.keys(out.finished || {}).forEach((id)=>{
    if (!out.finished[id] || typeof out.finished[id] !== 'object') out.finished[id] = { stock: 0 };
    out.finished[id].stock = invParseNumberPOS(out.finished[id].stock || 0);
  });

  Object.keys(out.finishedByProductId || {}).forEach((id)=>{
    if (!out.finishedByProductId[id] || typeof out.finishedByProductId[id] !== 'object') out.finishedByProductId[id] = { stock: 0 };
    out.finishedByProductId[id].stock = invParseNumberPOS(out.finishedByProductId[id].stock || 0);
  });

  return out;
}
function invCentralLoadPOS(){
  try{
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
      const data = A33Storage.sharedGet(STORAGE_KEY_INVENTARIO, invCentralDefaultPOS(), 'local');
      return invCentralNormalizePOS(data);
    }
  }catch(e){
    console.warn('Error leyendo inventario central (sharedGet)', e);
  }

  try{
    const raw = A33Storage.getItem(STORAGE_KEY_INVENTARIO);
    let data = raw ? JSON.parse(raw) : null;
    return invCentralNormalizePOS(data);
  }catch(e){
    console.warn('Error leyendo inventario central', e);
    return invCentralDefaultPOS();
  }
}
function invCentralSavePOS(inv){
  try{
    if (window.A33Storage && typeof A33Storage.sharedSet === 'function'){
      const r = A33Storage.sharedSet(STORAGE_KEY_INVENTARIO, inv, { source: 'pos' });
      if (!r || !r.ok){
        console.warn('Error guardando inventario central (sharedSet)', r);
      }
      return;
    }
  }catch(e){
    console.warn('Error guardando inventario central (sharedSet)', e);
  }

  try{
    A33Storage.setItem(STORAGE_KEY_INVENTARIO, JSON.stringify(inv));
  }catch(e){
    console.warn('Error guardando inventario central', e);
  }
}
function mapProductNameToFinishedId(name){
  const n = (name||'').toString().toLowerCase();
  if (n.includes('pulso') && n.includes('250')) return 'pulso';
  if (n.includes('media') && n.includes('375')) return 'media';
  if (n.includes('djeba') && n.includes('750')) return 'djeba';
  if (n.includes('litro') && n.includes('1000')) return 'litro';
  if (n.includes('gal') && (n.includes('3750') || n.includes('3800') || n.includes('galon') || n.includes('galón'))) return 'galon';
  return null;
}
function saleProductIdForInventoryPOS(sale){
  if (!sale || typeof sale !== 'object') return null;
  const raw = sale.productId ?? sale.productoId ?? (sale.productSnapshot && sale.productSnapshot.productId);
  const value = String(raw == null ? '' : raw).trim();
  return value || null;
}
function saleProductNameForInventoryPOS(sale){
  if (!sale || typeof sale !== 'object') return '';
  return String(
    sale.productNameSnapshot ||
    sale.productName ||
    sale.name ||
    (sale.productSnapshot && (sale.productSnapshot.productName || sale.productSnapshot.name)) ||
    ''
  ).trim();
}
function saleManagesFinishedInventoryPOS(sale){
  if (!sale || typeof sale !== 'object') return true;
  if (sale.isExtra) return false;
  const snap = sale.productSnapshot && typeof sale.productSnapshot === 'object' ? sale.productSnapshot : null;
  if (snap && snap.manageStock === false) return false;
  if (sale.manageStock === false) return false;
  return true;
}
function applyFinishedFromSalePOS(sale, direction){
  try{
    if (!saleManagesFinishedInventoryPOS(sale)) return;

    const dir = direction === -1 ? -1 : 1;
    const productName = saleProductNameForInventoryPOS(sale);
    const productId = saleProductIdForInventoryPOS(sale);
    const finishedId = mapProductNameToFinishedId(productName);
    const q = typeof sale.qty === 'number' ? sale.qty : parseFloat(sale.qty||'0');
    const qty = Number.isNaN(q) ? 0 : q;
    if (!qty) return;

    const delta = -dir * qty; // dir=+1: registrar venta/devolución; dir=-1: revertir
    const inv = invCentralLoadPOS();

    // Productos con identidad estable: siempre se descuentan por productId.
    // Dos productos con el mismo nombre nunca comparten inventario terminado.
    if (productId){
      const key = String(productId);
      if (!inv.finishedByProductId || typeof inv.finishedByProductId !== 'object') inv.finishedByProductId = {};
      if (!inv.finishedByProductId[key] || typeof inv.finishedByProductId[key] !== 'object'){
        inv.finishedByProductId[key] = { stock: 0 };
      }
      const row = inv.finishedByProductId[key];
      row.stock = invParseNumberPOS(row.stock) + delta;
      row.productId = productId;
      row.name = productName || row.name || ('Producto ' + productId);
      row.productName = productName || row.productName || row.name;
      row.updatedAt = new Date().toISOString();
      invCentralSavePOS(inv);
      return;
    }

    // Compatibilidad exclusiva para ventas históricas sin productId estable.
    if (finishedId){
      if (!inv.finished || typeof inv.finished !== 'object') inv.finished = {};
      if (!inv.finished[finishedId] || typeof inv.finished[finishedId] !== 'object') inv.finished[finishedId] = { stock: 0 };
      inv.finished[finishedId].stock = invParseNumberPOS(inv.finished[finishedId].stock) + delta;
      invCentralSavePOS(inv);
    }
  }catch(e){
    console.error('Error ajustando inventario central desde venta', e);
  }
}


// ------------------------------------------------------------
// VASOS (Etapa 2/3): Auto-descuento de consumible "Vasos 12oz"
// - Fuente: panel VASOS del POS (venta/cortesía por vaso)
// - Destino: Inventario central (Tapas Auto) -> caps.vasos12oz.stock
// - Nota: SIN reversión todavía (Etapa 3)
// ------------------------------------------------------------
const CAP_ITEM_VASOS12OZ_ID = 'vasos12oz';

function toIntSafePOS(v, fallback=0){
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}



function getVasos12ozSourceIdFromSalePOS(sale){
  try{
    if (!sale || typeof sale !== 'object') return 'vasos12oz|sale:unknown';
    const uid = (sale.uid != null && String(sale.uid).trim() !== '') ? String(sale.uid).trim() : '';
    const id = (sale.id != null && String(sale.id).trim() !== '') ? String(sale.id).trim() : '';
    const createdAt = (sale.createdAt != null && String(sale.createdAt).trim() !== '') ? String(sale.createdAt).trim() : '';
    const base = uid || (id ? ('id:' + id) : (createdAt ? ('ts:' + createdAt) : 'unknown'));
    return 'vasos12oz|' + base;
  }catch(_){
    return 'vasos12oz|sale:unknown';
  }
}
function ensureCapsShapePOS(inv){
  if (!inv || typeof inv !== 'object') inv = {};
  if (!inv.caps || typeof inv.caps !== 'object') inv.caps = {};
  if (!inv.caps[CAP_ITEM_VASOS12OZ_ID] || typeof inv.caps[CAP_ITEM_VASOS12OZ_ID] !== 'object'){
    inv.caps[CAP_ITEM_VASOS12OZ_ID] = { stock: 0, min: 0 };
  }
  const it = inv.caps[CAP_ITEM_VASOS12OZ_ID];
  // Stock puede ser negativo (entero). Min siempre >= 0.
  it.stock = toIntSafePOS(it.stock, 0);
  it.min = Math.max(0, toIntSafePOS(it.min, 0));
  return inv;
}


function adjustVasos12ozStockFromPOS(qtyUsed, opts){
  const raw = toIntSafePOS(qtyUsed, 0);
  const qty = Math.abs(raw);
  const mode = (opts && opts.mode === 'revert') ? 'revert' : 'apply';
  const sourceId = (opts && opts.sourceId != null && String(opts.sourceId).trim() !== '') ? String(opts.sourceId).trim() : '';

  if (!(qty > 0)) return { ok:true, skipped:true, before:null, after:null, mode, sourceId, reason:'qty_zero' };

  const nowTs = ()=>{
    try{ return Date.now(); }catch(_){ return (new Date()).getTime(); }
  };

  function applyEffectToInv(invObj){
    const inv = ensureCapsShapePOS(invObj || {});
    const it = inv.caps[CAP_ITEM_VASOS12OZ_ID];
    const before = toIntSafePOS(it.stock, 0);

    // Sin sourceId: comportamiento legacy (solo ajustar stock)
    if (!sourceId){
      const delta = (mode === 'revert') ? qty : (-qty);
      it.stock = before + delta;
      return { inv, before, after: it.stock, skipped:false, reason:'' };
    }

    if (!it.effects || typeof it.effects !== 'object') it.effects = {};
    const eff = it.effects[sourceId];

    if (mode === 'apply'){
      if (eff && eff.state === 'APPLIED'){
        return { inv, before, after: before, skipped:true, reason:'already_applied' };
      }
      const after = before - qty;
      it.stock = after;
      it.effects[sourceId] = {
        qty,
        state: 'APPLIED',
        appliedAt: nowTs(),
        revertedAt: (eff && eff.revertedAt != null) ? eff.revertedAt : null
      };
      return { inv, before, after, skipped:false, reason:'' };
    }

    // mode === 'revert'
    if (eff && eff.state === 'REVERTED'){
      return { inv, before, after: before, skipped:true, reason:'already_reverted' };
    }

    // Si hay evidencia previa, revertimos exactamente lo aplicado. Si no, hacemos reversión best-effort (una sola vez).
    const qtyEff = (eff && eff.qty != null) ? Math.abs(toIntSafePOS(eff.qty, qty)) : qty;
    const after = before + qtyEff;
    it.stock = after;
    it.effects[sourceId] = {
      qty: qtyEff,
      state: 'REVERTED',
      appliedAt: (eff && eff.appliedAt != null) ? eff.appliedAt : null,
      revertedAt: nowTs(),
      legacy: !(eff && eff.state)
    };
    return { inv, before, after, skipped:false, reason:'' };
  }

  // Mejor opción: sharedRead + sharedSet con bloqueo por conflicto y reintento.
  try{
    if (window.A33Storage && typeof A33Storage.sharedRead === 'function' && typeof A33Storage.sharedSet === 'function'){
      for (let attempt=0; attempt<2; attempt++){
        const r0 = A33Storage.sharedRead(STORAGE_KEY_INVENTARIO, {}, 'local');
        const baseRev = (r0 && r0.meta && typeof r0.meta.rev === 'number') ? r0.meta.rev : null;

        const applied = applyEffectToInv((r0 && r0.data) ? r0.data : {});
        if (applied && applied.skipped){
          return { ok:true, skipped:true, before:applied.before, after:applied.after, mode, sourceId, reason:applied.reason };
        }

        const r = A33Storage.sharedSet(STORAGE_KEY_INVENTARIO, applied.inv, { source:'pos', baseRev, conflictPolicy:'block' });
        if (r && r.ok) return { ok:true, skipped:false, before:applied.before, after:applied.after, mode, sourceId };
        if (r && r.conflict) continue; // reintentar con data fresca
        return { ok:false, skipped:false, mode, sourceId, message: (r && r.message) ? r.message : 'No se pudo actualizar Vasos 12oz.' };
      }
      return { ok:false, skipped:false, mode, sourceId, message:'Conflicto al actualizar Vasos 12oz. Recargá e intentá de nuevo.' };
    }
  }catch(e){
    console.warn('Error actualizando Vasos 12oz (shared)', e);
  }

  // Fallback (si no está el contrato shared)
  try{
    const applied = applyEffectToInv(invCentralLoadPOS());
    if (applied && applied.skipped){
      return { ok:true, skipped:true, before:applied.before, after:applied.after, mode, sourceId, reason:applied.reason, fallback:true };
    }
    invCentralSavePOS(applied.inv);
    return { ok:true, skipped:false, before:applied.before, after:applied.after, mode, sourceId, fallback:true };
  }catch(e){
    console.warn('Error actualizando Vasos 12oz (fallback)', e);
    return { ok:false, skipped:false, mode, sourceId, message:'No se pudo actualizar Vasos 12oz (fallback).' };
  }
}


async function renderCentralFinishedPOS(){
  const tbody = document.querySelector('#tbl-inv-central tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const inv = invCentralLoadPOS();
  const defs = [];
  const seen = new Set();

  try{
    const products = await getAll('products');
    (Array.isArray(products) ? products : []).forEach((product) => {
      const productId = catalogProductStableIdPOS(product);
      if (!productId || seen.has(productId)) return;
      seen.add(productId);
      const label = String(product.name || product.nombre || ('Producto ' + productId)).trim();
      defs.push({ id:productId, label, legacy:false });
    });
  }catch(_){ }

  // Históricos borrados/inactivos: se conservan por identidad, pero nunca se convierten en Productos.
  Object.keys(inv.finishedByProductId || {}).forEach((productId) => {
    if (seen.has(productId)) return;
    const info = inv.finishedByProductId[productId] || {};
    const stock = invParseNumberPOS(info.stock);
    if (!stock && !info.productName && !info.name) return;
    seen.add(productId);
    defs.push({
      id:String(productId),
      label:String(info.productName || info.name || ('Producto histórico ' + productId)).trim(),
      legacy:false,
      historical:true
    });
  });

  // Compatibilidad histórica sin productId: solo filas realmente existentes, nunca cinco defaults vacíos.
  const legacyLabels = {
    pulso:'Pulso 250 ml', media:'Media 375 ml', djeba:'Djeba 750 ml',
    litro:'Litro 1000 ml', galon:'Galón 3720 ml'
  };
  Object.keys(inv.finished || {}).forEach((legacyId) => {
    const info = inv.finished[legacyId] || {};
    const stock = invParseNumberPOS(info.stock);
    if (!stock && !info.productName && !info.name) return;
    defs.push({
      id:String(legacyId),
      label:String(info.productName || info.name || legacyLabels[legacyId] || ('Histórico ' + legacyId)).trim(),
      legacy:true,
      historical:true
    });
  });

  defs.sort((a,b) => String(a.label || '').localeCompare(String(b.label || ''), 'es-NI', { sensitivity:'base' }));
  if (!defs.length){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="2"><small class="muted">No hay Productos registrados en Catálogos.</small></td>';
    tbody.appendChild(tr);
    return;
  }

  defs.forEach((def) => {
    const info = def.legacy
      ? ((inv.finished && inv.finished[def.id]) || { stock:0 })
      : ((inv.finishedByProductId && inv.finishedByProductId[def.id]) || { stock:0 });
    const stock = invParseNumberPOS(info.stock);
    const suffix = def.historical ? ' <small class="muted">(histórico)</small>' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(def.label)}${suffix}</td><td>${stock}</td>`;
    tbody.appendChild(tr);
  });
}

function leerCostosPresentacion() {
  try {
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
      const data = A33Storage.sharedGet(RECETAS_KEY, null, 'local');
      if (data && data.costosPresentacion) {
        return data.costosPresentacion;
      }
      return null;
    }
  } catch (e) {
    console.warn('No se pudieron leer los costos de presentacion (sharedGet):', e);
  }

  try {
    const raw = A33Storage.getItem(RECETAS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.costosPresentacion) {
      return data.costosPresentacion;
    }
    return null;
  } catch (e) {
    console.warn('No se pudieron leer los costos de presentacion desde la Calculadora:', e);
    return null;
  }
}

function mapProductNameToPresId(name) {
  const n = normName(name);
  if (!n) return null;
  if (n.includes('pulso')) return 'pulso';
  if (n.includes('media')) return 'media';
  if (n.includes('djeba')) return 'djeba';
  if (n.includes('litro')) return 'litro';
  if (n.includes('galon')) return 'galon';
  if (n.includes('galón')) return 'galon';
  return null;
}

function getCostoUnitarioProducto(productName) {
  const costos = leerCostosPresentacion();
  if (!costos) return 0;
  const presId = mapProductNameToPresId(productName);
  if (!presId) return 0;
  const info = costos[presId];
  if (!info) return 0;
  const val = typeof info.costoUnidad === 'number' ? info.costoUnidad : 0;
  return val > 0 ? val : 0;
}

// Defaults (SKUs Arcano 33)
const DEFAULT_GALON_PRICE_POS = 900;
const LEGACY_DEFAULT_GALON_PRICE_POS = 800;
const SEED = Object.freeze([]); // Productos: sin semillas fuera de Catálogos → Productos.

const CATALOG_DELETED_KEYS_POS = {
  products:'a33_catalog_deleted_products_v1',
  banks:'a33_catalog_deleted_banks_v1'
};
const DEFAULT_EVENTS = [{name:'General'}];

function readCatalogDeletedKeysPOS(kind){
  const storageKey = CATALOG_DELETED_KEYS_POS[kind];
  if (!storageKey) return new Set();
  try{
    const raw = localStorage.getItem(storageKey);
    const arr = JSON.parse(raw || '[]');
    return new Set((Array.isArray(arr) ? arr : []).map(v => String(v || '').trim()).filter(Boolean));
  }catch(_){ return new Set(); }
}

function writeCatalogDeletedKeysPOS(kind, keys){
  const storageKey = CATALOG_DELETED_KEYS_POS[kind];
  if (!storageKey) return false;
  try{
    const arr = Array.from(keys || []).map(v => String(v || '').trim()).filter(Boolean).sort();
    localStorage.setItem(storageKey, JSON.stringify(arr));
    return true;
  }catch(_){ return false; }
}

function clearCatalogDeletedPOS(kind){
  const storageKey = CATALOG_DELETED_KEYS_POS[kind];
  if (!storageKey) return;
  try{ localStorage.removeItem(storageKey); }catch(_){ }
}

function catalogDeletedKeyPOS(kind, row){
  const r = row && typeof row === 'object' ? row : {};
  if (kind === 'banks') return `${normBankName(r.name || '')}::${normalizeBankTypePOS(r.type || r.bankType || 'transferencia')}`;
  return normKeyPOS(r.name || r.nombre || '');
}

function rememberCatalogDeletedPOS(kind, row){
  const keys = readCatalogDeletedKeysPOS(kind);
  const main = catalogDeletedKeyPOS(kind, row);
  if (main) keys.add(main);
  if (kind === 'products' && mapProductNameToFinishedIdPOS(row && row.name) === 'galon') keys.add(normKeyPOS('Galón 3720 ml'));
  writeCatalogDeletedKeysPOS(kind, keys);
}

function wasCatalogSeedDeletedPOS(kind, row){
  const key = catalogDeletedKeyPOS(kind, row);
  return !!(key && readCatalogDeletedKeysPOS(kind).has(key));
}

function isValidCatalogPricePOS(value){
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasOwnPOS(obj, key){
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function boolCatalogFlagPOS(value, fallback){
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const raw = String(value ?? '').trim().toLowerCase();
  if (['true','1','si','sí','yes','y','on'].includes(raw)) return true;
  if (['false','0','no','n','off'].includes(raw)) return false;
  return !!fallback;
}

function productActiveForSalePOS(product){
  const p = product && typeof product === 'object' ? product : {};
  if (hasOwnPOS(p, 'active')) return boolCatalogFlagPOS(p.active, true);
  if (hasOwnPOS(p, 'activo')) return boolCatalogFlagPOS(p.activo, true);
  if (hasOwnPOS(p, 'isActive')) return boolCatalogFlagPOS(p.isActive, true);
  if (hasOwnPOS(p, 'enabled')) return boolCatalogFlagPOS(p.enabled, true);
  return true;
}

function hasExplicitActiveFlagPOS(product){
  const p = product && typeof product === 'object' ? product : {};
  return ['active','activo','isActive','enabled'].some((key) => hasOwnPOS(p, key));
}

function hasExplicitManageStockFlagPOS(product){
  const p = product && typeof product === 'object' ? product : {};
  return ['manageStock','manejarInventario','managesStock','stockManaged','controlStock','inventoryManaged'].some((key) => hasOwnPOS(p, key));
}

function productManageStockForSalePOS(product, fallback=true){
  const p = product && typeof product === 'object' ? product : {};
  const keys = ['manageStock','manejarInventario','managesStock','stockManaged','controlStock','inventoryManaged'];
  for (const key of keys){
    if (hasOwnPOS(p, key)) return boolCatalogFlagPOS(p[key], fallback);
  }
  return !!fallback;
}

function productRecipeEnabledForProductionPOS(product){
  const p = product && typeof product === 'object' ? product : {};
  const keys = ['receta','Receta','recipe','hasRecipe'];
  for (const key of keys){
    if (hasOwnPOS(p, key)) return boolCatalogFlagPOS(p[key], false);
  }
  // Fuente única: sin marca Receta explícita, el producto no hereda comportamiento por nombre.
  return false;
}

function legacyGallonVendibleNamePOS(name){
  const n = normName(name);
  return !!((n.includes('galon') || n.includes('galón')) && (n.includes('3750') || n.includes('3800') || n === 'galon' || n === 'galón'));
}

function legacyVendibleDefaultPOS(product){
  // Compatibilidad de firma únicamente: Catálogos debe marcar POS de forma explícita.
  return false;
}
function hasExplicitPosFlagPOS(product){
  const p = product && typeof product === 'object' ? product : {};
  return ['pos','POS','posEnabled','showInPOS','visiblePOS','vendible','sellable','saleEnabled']
    .some((key) => hasOwnPOS(p, key));
}

function productPosEnabledForSalePOS(product){
  const p = product && typeof product === 'object' ? product : {};
  const keys = ['pos','POS','posEnabled','showInPOS','visiblePOS','vendible','sellable','saleEnabled'];
  for (const key of keys){
    if (hasOwnPOS(p, key)) return boolCatalogFlagPOS(p[key], false);
  }
  // Fuente única: sin marca POS explícita el producto no se publica en el selector.
  return false;
}

function catalogProductStableIdPOS(product){
  if (!product || typeof product !== 'object') return '';
  try{
    if (window.A33Products && typeof window.A33Products.getProductId === 'function'){
      return String(window.A33Products.getProductId(product) || '').trim();
    }
  }catch(_){ }
  return String(product.productId ?? product.productoId ?? product.catalogProductId ?? '').trim();
}

function catalogProductInternalIdPOS(product){
  if (!product || typeof product !== 'object') return null;
  const n = Number(product.id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function findCatalogProductByStableIdPOS(products, productId){
  const target = String(productId == null ? '' : productId).trim();
  if (!target) return null;
  return (Array.isArray(products) ? products : []).find((product) => catalogProductStableIdPOS(product) === target) || null;
}

function saleStableProductIdPOS(sale){
  if (!sale || typeof sale !== 'object') return '';
  const raw = sale.productId ?? sale.productoId ?? (sale.productSnapshot && sale.productSnapshot.productId);
  return String(raw == null ? '' : raw).trim();
}

function saleInternalProductIdPOS(sale){
  if (!sale || typeof sale !== 'object') return null;
  const raw = sale.productInternalId ?? sale.catalogInternalId ?? (sale.productSnapshot && sale.productSnapshot.internalId);
  const direct = Number(raw);
  if (Number.isFinite(direct) && direct > 0) return direct;
  // Compatibilidad histórica: antes productId contenía el id autoincremental numérico.
  const legacy = Number(sale.productId);
  return Number.isFinite(legacy) && legacy > 0 ? legacy : null;
}

function saleMatchesCatalogProductPOS(sale, product){
  if (!sale || !product) return false;
  const stable = catalogProductStableIdPOS(product);
  const saleStable = saleStableProductIdPOS(sale);
  if (stable && saleStable && stable === saleStable) return true;
  const internalId = catalogProductInternalIdPOS(product);
  const saleInternalId = saleInternalProductIdPOS(sale);
  return !!(internalId && saleInternalId && internalId === saleInternalId);
}

function productSellableInPOS(product){
  return !!(product && catalogProductStableIdPOS(product) && productActiveForSalePOS(product) && productPosEnabledForSalePOS(product));
}


// POS: snapshots históricos por venta.
// La venta usa productId estable y conserva el id interno solo para compatibilidad del inventario por evento.

function catalogProductSnapshotNamePOS(product){
  if (!product || typeof product !== 'object') return '';
  return String(product.name || product.nombre || product.productName || '').trim();
}

function catalogProductSnapshotPricePOS(product, selectedUnitPrice){
  const selected = Number(selectedUnitPrice);
  if (Number.isFinite(selected) && selected >= 0) return round2(selected);
  const catalog = Number(product && (product.price ?? product.precio ?? product.unitPrice));
  return Number.isFinite(catalog) && catalog >= 0 ? round2(catalog) : 0;
}

function buildSaleProductSnapshotPOS(product, selectedUnitPrice){
  const productId = catalogProductStableIdPOS(product);
  const productName = catalogProductSnapshotNamePOS(product);
  const unitPrice = catalogProductSnapshotPricePOS(product, selectedUnitPrice);
  const unitCost = getProductStoredUnitCostPOS(product);
  const capacityMl = Number(product && (product.capacityMl ?? product.ml ?? product.contenidoMl));
  const productInternalId = catalogProductInternalIdPOS(product);
  const productSnapshot = {
    kind: 'product',
    id: productId,
    productId,
    internalId: productInternalId,
    name: productName,
    productName,
    price: unitPrice,
    unitPrice,
    catalogPrice: catalogProductSnapshotPricePOS(product, product && product.price),
    unitCost,
    costPerUnit: unitCost,
    costoUnitario: unitCost,
    manageStock: product ? productManageStockForSalePOS(product, true) : null,
    active: product ? productActiveForSalePOS(product) : null,
    pos: product ? productPosEnabledForSalePOS(product) : null,
    receta: product ? boolCatalogFlagPOS(product.receta, false) : false,
    letra: String((product && (product.letra ?? product.letter ?? '')) || '').trim(),
    envaseId: String((product && (product.envaseId ?? product.bottleId ?? '')) || '').trim(),
    tapaId: String((product && (product.tapaId ?? product.capId ?? '')) || '').trim(),
    capacityMl: Number.isFinite(capacityMl) && capacityMl > 0 ? capacityMl : null,
    presKey: productName ? (presKeyFromProductNamePOS(productName) || '') : '',
    capturedAt: new Date().toISOString()
  };
  return {
    productId,
    productInternalId,
    productName,
    productNameSnapshot: productName,
    unitPrice,
    unitPriceSnapshot: unitPrice,
    productSnapshot
  };
}

function getSaleProductNameSnapshotPOS(sale){
  if (!sale || typeof sale !== 'object') return '';
  return String(
    sale.productNameSnapshot ||
    sale.productName ||
    sale.name ||
    sale.producto ||
    sale.product ||
    ''
  ).trim();
}

function getSaleUnitPriceSnapshotPOS(sale){
  if (!sale || typeof sale !== 'object') return 0;
  const candidates = [sale.unitPriceSnapshot, sale.unitPrice, sale.price, sale.precio];
  for (const c of candidates){
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function applyProductSaleCatalogDefaultsPOS(product, seed){
  if (!product || typeof product !== 'object' || !seed) return false;
  let changed = false;
  if (!hasExplicitPosFlagPOS(product) && typeof seed.pos !== 'undefined'){ product.pos = !!seed.pos; changed = true; }
  if (typeof product.receta === 'undefined' && typeof seed.receta !== 'undefined'){ product.receta = !!seed.receta; changed = true; }
  if (typeof product.letra === 'undefined' && typeof seed.letra !== 'undefined'){ product.letra = seed.letra || ''; changed = true; }
  if (typeof product.envaseId === 'undefined' && typeof seed.envaseId !== 'undefined'){ product.envaseId = seed.envaseId || ''; changed = true; }
  if (typeof product.tapaId === 'undefined' && typeof seed.tapaId !== 'undefined'){ product.tapaId = seed.tapaId || ''; changed = true; }
  return changed;
}

async function seedMissingDefaults(force=false, options={}){
  // Etapa 2/8 — Catálogos → Productos es la única puerta de creación.
  // Se conserva la firma por compatibilidad con HTML/código antiguo, pero POS no inserta,
  // completa, reactiva ni restaura productos bajo ninguna condición.
  return { ok:true, skipped:true, reason:'catalogos_productos_fuente_unica', force:!!force, options:options || {} };
}

// UI helpers
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function fmt(n){ return (n||0).toLocaleString('es-NI', {minimumFractionDigits:2, maximumFractionDigits:2}); }
let toastTimerId = null;
function showToast(msg, type='ok', durationMs=5000){
  const t = document.getElementById('toast');
  if (!t) return;
  // Accesibilidad
  if (!t.hasAttribute('role')) t.setAttribute('role','status');
  if (!t.hasAttribute('aria-live')) t.setAttribute('aria-live','polite');
  if (!t.hasAttribute('aria-atomic')) t.setAttribute('aria-atomic','true');

  const d = Math.max(800, Number(durationMs || 0) || 0);

  // Limpiar timeout previo si hay otro toast en curso
  if (toastTimerId){
    clearTimeout(toastTimerId);
    toastTimerId = null;
  }

  // Reset clases de tipo
  t.classList.remove('ok','error');
  t.classList.add(type === 'error' ? 'error' : 'ok');

  t.textContent = String(msg || '');
  t.style.setProperty('--toast-duration', d + 'ms');

  // Reiniciar animación
  t.classList.remove('show');
  void t.offsetWidth; // force reflow
  t.classList.add('show');

  toastTimerId = setTimeout(()=>{
    t.classList.remove('show');
  }, d);
}

// Compat: toasts rápidos existentes
function toast(msg){ showToast(msg, 'ok', 1800); }

// --- Helpers POS: hora/orden robustos (para listas y export)
function pad2POS(n){
  const v = Math.floor(Math.abs(Number(n) || 0));
  return (v < 10 ? '0' : '') + v;
}

function toHHMMFromDatePOS(d){
  try{
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    return pad2POS(d.getHours()) + ':' + pad2POS(d.getMinutes());
  }catch(e){
    return '';
  }
}

function fmtDDMMYYYYHHMM_POS(date){
  try{
    const d = (date instanceof Date) ? date : new Date(date);
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    return pad2POS(d.getDate()) + '/' + pad2POS(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + toHHMMFromDatePOS(d);
  }catch(e){
    return '';
  }
}

function getSaleTimeTextPOS(s){
  if (!s) return '';
  // Campo clásico
  if (typeof s.time === 'string' && s.time.trim()) return s.time.trim();
  // Variantes (por compatibilidad)
  if (typeof s.hora === 'string' && s.hora.trim()) return s.hora.trim();
  if (typeof s.hour === 'string' && s.hour.trim()) return s.hour.trim();

  // Intentar derivar de timestamps comunes
  const cand = (s.createdAt ?? s.ts ?? s.timestamp ?? s.created_at ?? s.createdAtISO ?? s.created_at_iso ?? null);
  let d = null;
  if (typeof cand === 'number' && isFinite(cand) && cand > 0){
    d = new Date(cand);
  } else if (typeof cand === 'string' && cand.trim()){
    const t = Date.parse(cand);
    if (!isNaN(t)) d = new Date(t);
  }
  const hhmm = toHHMMFromDatePOS(d);
  return hhmm || '';
}

function saleSortKeyPOS(s){
  if (!s) return 0;
  // Preferir timestamps si existen
  const cand = (s.createdAt ?? s.ts ?? s.timestamp ?? s.created_at ?? null);
  if (typeof cand === 'number' && isFinite(cand) && cand > 0) return cand;
  if (typeof cand === 'string' && cand.trim()){
    const t = Date.parse(cand);
    if (!isNaN(t)) return t;
  }
  // Fallback a id autoincremental
  const idn = Number(s.id || 0);
  return (Number.isFinite(idn) ? idn : 0);
}

// Descuento total (compatibilidad: ventas antiguas / Extras)
function getSaleDiscountTotalPOS(s){
  if (!s) return 0;
  const d = Number(s.discount);
  if (Number.isFinite(d)) return d;
  const du = Number(s.discountPerUnit);
  if (Number.isFinite(du) && du > 0){
    const q = Math.abs(Number(s.qty || 0));
    return du * q;
  }
  return 0;
}


// --- Consecutivo por evento (N°) para ventas (incluye Extras)
// Nota: mantenemos el `id` real (autoincrement/timestamp) para trazabilidad.
// El consecutivo oficial por evento se guarda en `sale.seqId` y se exporta como "N°".
function isLikelyAutoIdPOS(n){
  return Number.isFinite(n) && n > 0 && n < 1000000000; // ids autoincrement típicos
}

function getSaleExistingSeqCandidatePOS(s){
  const seq = Number(s && s.seqId);
  if (Number.isFinite(seq) && seq > 0) return seq;
  const idn = Number(s && s.id);
  if (isLikelyAutoIdPOS(idn)) return idn;
  return 0;
}

function computeEventSaleSeqBasePOS(sales){
  let base = 0;
  if (!Array.isArray(sales)) return base;
  for (const s of sales){
    const cand = getSaleExistingSeqCandidatePOS(s);
    if (cand > base) base = cand;
  }
  return base;
}

async function backfillSaleSeqIdsForEventPOS(eventId, ev=null, sales=null){
  try{
    const event = ev || await getEventByIdPOS(eventId);
    if (!event) return { updated:0, saleSeq:0 };

    const allSales = sales || (await getAll('sales')).filter(s=>s.eventId===eventId);
    const used = new Set();
    let base = computeEventSaleSeqBasePOS(allSales);

    // Reservar números ya usados
    for (const s of allSales){
      const seq = Number(s && s.seqId);
      if (Number.isFinite(seq) && seq > 0) used.add(seq);
      const idn = Number(s && s.id);
      if (isLikelyAutoIdPOS(idn)) used.add(idn);
    }

    let updated = 0;
    for (const s of allSales){
      const cur = Number(s && s.seqId);
      if (Number.isFinite(cur) && cur > 0) continue;

      const idn = Number(s && s.id);

      // Si el id "parece" autoincrement y no colisiona, usarlo como N°
      if (isLikelyAutoIdPOS(idn) && !used.has(idn)){
        s.seqId = idn;
        used.add(idn);
        if (idn > base) base = idn;
      } else {
        // Si el id es timestamp (muy grande) o colisiona, asignar el siguiente consecutivo
        do { base += 1; } while (used.has(base));
        s.seqId = base;
        used.add(base);
      }

      try{
        await put('sales', s);
        updated++;
      }catch(e){}
    }

    // Actualizar contador del evento (no bajarlo nunca)
    const curSeq = Number(event.saleSeq || 0);
    if (!Number.isFinite(curSeq) || curSeq < base) event.saleSeq = base;

    try{ await put('events', event); }catch(e){}
    return { updated, saleSeq: Number(event.saleSeq||0) };
  }catch(e){
    console.warn('No se pudo backfill de N° por evento', e);
    return { updated:0, saleSeq:0 };
  }
}

async function ensureNewSaleSeqIdPOS(event, saleRecord){
  if (!event || !saleRecord) return;

  // Si el evento no tiene contador, inicializar desde ventas existentes (una sola vez)
  let curSeq = Number(event.saleSeq || 0);
  if (!Number.isFinite(curSeq) || curSeq <= 0){
    const sales = (await getAll('sales')).filter(s=>s.eventId===event.id);
    const hasMissing = sales.some(s => !(Number(s && s.seqId) > 0));
    if (hasMissing){
      const res = await backfillSaleSeqIdsForEventPOS(event.id, event, sales);
      curSeq = Number(res.saleSeq || 0);
    } else {
      curSeq = computeEventSaleSeqBasePOS(sales);
      event.saleSeq = curSeq;
      await put('events', event);
    }
  }

  curSeq = Number(event.saleSeq || curSeq || 0);
  const next = (Number.isFinite(curSeq) ? curSeq : 0) + 1;

  saleRecord.seqId = next;
  event.saleSeq = next;

  await put('events', event);
}

function getSaleSeqDisplayPOS(s){
  const n = Number(s && s.seqId);
  if (Number.isFinite(n) && n > 0) return String(n);
  const idn = Number(s && s.id);
  return (Number.isFinite(idn) ? String(idn) : '');
}

function humanizeError(err){
  if (!err) return 'Error desconocido.';
  if (typeof err === 'string') return err;
  const name = err.name || '';
  const msg = err.message || String(err);

  // Hardening 9E: si parece error de IndexedDB, devolver detalle guiado
  try{
    const nm = String(name || '').toLowerCase();
    const mm = String(msg || '').toLowerCase();
    const maybeIdb = (err && err.code && String(err.code).startsWith('IDB_'))
      || nm.includes('abort') || nm.includes('transaction') || nm.includes('quota') || nm.includes('invalidstate')
      || nm.includes('notfound') || nm.includes('dataerror') || nm.includes('unknownerror') || nm.includes('versionerror') || nm.includes('timeout')
      || mm.includes('indexeddb') || mm.includes('idb') || mm.includes('transaction') || mm.includes('quota');
    if (maybeIdb && typeof pcMapIdbErrorToTech === 'function'){
      const m = pcMapIdbErrorToTech(err, { op:'persist', store:'—', key:'—' });
      if (m && m.code && String(m.code).startsWith('IDB_')) return m.detail;
    }
  }catch(_){ }

  if (name === 'TransactionInactiveError') return 'La transacción de la base de datos se cerró antes de tiempo. Recarga el POS y vuelve a intentar.';
  if (name === 'QuotaExceededError') return 'El navegador se quedó sin espacio para guardar datos (QuotaExceeded). Libera espacio o prueba otro navegador.';
  if (name === 'InvalidStateError') return 'El navegador no permitió la operación en este estado (InvalidState). Cierra otras pestañas del POS y recarga.';
  if (name === 'NotFoundError') return 'No se encontró el registro/almacén en la base de datos (NotFound).';
  if (name === 'DataError') return 'Dato inválido para la base de datos (DataError).';
  if (name === 'A33AtomicAbort') return 'Transacción abortada. Rollback OK: no se guardó ni el cierre ni el candado.';

  return msg;
}




// --- Persistencia robusta (Etapa 1): alertas bloqueantes + atomicidad en flujos críticos
function posBlockingAlert(msg){
  try{ alert(msg); }catch(_){ }
  try{ if (typeof showToast === 'function') showToast(msg, 'error', 7000); }catch(_){ }
}

function persistFailHelpPOS(){
  return 'Libera espacio, cierra otras pestañas del POS/Suite A33 y reintenta. No se registró la operación.';
}

function a33ValidationErrorPOS(msg){
  const e = new Error(String(msg || 'Validación fallida.'));
  e.name = 'A33ValidationError';
  return e;
}

function showPersistFailPOS(action, err){
  if (err && String(err.name || '') === 'A33ValidationError'){
    posBlockingAlert(String(err.message || err || 'Validación fallida.'));
    return;
  }
  const a = (action || 'operación').toString();
  const detail = humanizeError(err);
  const msg = `No se pudo guardar (${a}).\n\n${detail}\n\n${persistFailHelpPOS()}`;
  posBlockingAlert(msg);
}

// --- UI: candados de guardado (anti doble-click) + estado visible
// Objetivo: impedir doble click en acciones críticas y mostrar "Guardando…" mientras corre el guardado.
const __A33_SAVE_LOCKS_POS = new Set();

function getBtnByIdPOS(id){
  try{ return document.getElementById(id); }catch(_){ return null; }
}

function setBtnSavingStatePOS(btn, saving, label){
  if (!btn) return;
  try{
    if (saving){
      if (!btn.dataset.a33OrigText) btn.dataset.a33OrigText = btn.textContent || '';
      btn.disabled = true;
      btn.setAttribute('aria-busy','true');
      btn.textContent = label || 'Guardando…';
      btn.classList.add('is-saving');
    } else {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      const orig = btn.dataset.a33OrigText;
      if (orig != null) btn.textContent = orig;
      delete btn.dataset.a33OrigText;
      btn.classList.remove('is-saving');
    }
  }catch(_){ }
}

async function runWithSavingLockPOS({ key, btnIds, labelSaving, busyToast, onError, fn }){
  const lockKey = String(key || 'save');
  if (__A33_SAVE_LOCKS_POS.has(lockKey)){
    try{ if (busyToast) showToast(busyToast, 'error', 2500); }catch(_){ }
    return;
  }

  __A33_SAVE_LOCKS_POS.add(lockKey);
  const ids = Array.isArray(btnIds) ? btnIds : [];
  const btns = ids.map(getBtnByIdPOS).filter(Boolean);

  // Bloquear y mostrar estado
  for (const b of btns) setBtnSavingStatePOS(b, true, labelSaving || 'Guardando…');

  try{
    await (fn ? fn() : Promise.resolve());
  }catch(err){
    try{
      if (typeof onError === 'function') onError(err);
      else showPersistFailPOS(lockKey, err);
    }catch(_){ }
  }finally{
    for (const b of btns) setBtnSavingStatePOS(b, false);
    __A33_SAVE_LOCKS_POS.delete(lockKey);
  }
}

function isValidYmdStrictPOS(v){
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
}

// Validación calendario real (YYYY-MM-DD). Para cierres diarios preferimos bloquear fechas imposibles.
function isValidYmdCalendarPOS(v){
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (dt.getUTCFullYear() === y) && ((dt.getUTCMonth() + 1) === mo) && (dt.getUTCDate() === d);
}

function normalizeDateKeyForClosePOS(input){
  const raw = (input == null) ? '' : String(input).trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  const candidate = m ? m[1] : raw;
  return isValidYmdCalendarPOS(candidate) ? candidate : null;
}

function validateSaleMinimalPOS(sale){
  if (!sale || typeof sale !== 'object') return { ok:false, msg:'Venta inválida.' };
  const evId = sale.eventId;
  if (!(Number.isFinite(Number(evId)) && Number(evId) > 0)) return { ok:false, msg:'Venta inválida: falta eventId.' };
  const dk = String(sale.date || '');
  if (!isValidYmdStrictPOS(dk)) return { ok:false, msg:'Venta inválida: dateKey inválido.' };
  const qty = Number(sale.qty);
  if (!Number.isFinite(qty) || qty === 0) return { ok:false, msg:'Venta inválida: cantidad inválida.' };
  const total = Number(sale.total);
  if (!Number.isFinite(total)) return { ok:false, msg:'Venta inválida: total inválido.' };
  const isReturn = !!sale.isReturn;
  if (!isReturn && total < -0.00001) return { ok:false, msg:'Venta inválida: total negativo (sin marcar como devolución).' };
  if (!isReturn && qty < 0) return { ok:false, msg:'Venta inválida: cantidad negativa (sin marcar como devolución).' };
  if (isReturn && qty > 0) return { ok:false, msg:'Venta inválida: devolución requiere cantidad negativa.' };
  const name = getSaleProductNameSnapshotPOS(sale);
  if (!name) return { ok:false, msg:'Venta inválida: nombre de producto vacío.' };

  // Validaciones duras (anti-NaN/negativos donde no aplica) antes de persistir
  const unitPrice = Number(getSaleUnitPriceSnapshotPOS(sale));
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { ok:false, msg:'Venta inválida: precio inválido.' };
  // Compat: ventas viejas no guardaban discountPerUnit → interpretar como 0.
  const discPU = (sale.discountPerUnit == null || sale.discountPerUnit === '')
    ? 0
    : Number(sale.discountPerUnit);
  if (!Number.isFinite(discPU) || discPU < 0) return { ok:false, msg:'Venta inválida: descuento inválido.' };
  const disc = (sale.discount == null || sale.discount === '') ? 0 : Number(sale.discount);
  if (!Number.isFinite(disc) || disc < 0) return { ok:false, msg:'Venta inválida: descuento total inválido.' };
  const hasDiscPU = !(sale.discountPerUnit == null || sale.discountPerUnit === '');
  const qtyAbs = Math.abs(qty);
  const subtotal = round2(unitPrice * qtyAbs);
  if (!sale.courtesy && discPU > unitPrice + 1e-9) return { ok:false, msg:'Venta inválida: descuento por unidad mayor que precio.' };
  if (!sale.courtesy && disc > subtotal + 1e-9) return { ok:false, msg:'Venta inválida: descuento total supera subtotal.' };
  // Consistencia (solo cuando existe discountPerUnit: regla final por unidad)
  if (hasDiscPU){
    const expectedDisc = round2(discPU * qtyAbs);
    if (!moneyEquals(disc, expectedDisc)) return { ok:false, msg:'Venta inválida: descuento inconsistente.' };
    const expectedTotalNoReturn = sale.courtesy ? 0 : round2(Math.max(0, subtotal - expectedDisc));
    const expectedTotal = isReturn ? -expectedTotalNoReturn : expectedTotalNoReturn;
    if (!moneyEquals(total, expectedTotal)) return { ok:false, msg:'Venta inválida: total inconsistente.' };
  }


  const pid = String(sale.productId == null ? '' : sale.productId).trim();
  const isExtra = !!sale.isExtra;
  if (isExtra){
    const ex = Number(sale.extraId);
    if (!(Number.isFinite(ex) && ex > 0)) return { ok:false, msg:'Venta inválida: extra inválido.' };
  } else {
    if (!pid) return { ok:false, msg:'Venta inválida: producto inválido.' };
  }

  const pay = normalizePaymentMethodPOS(sale.payment || '');
  if (isBankPaymentMethodPOS(pay)){
    const bid = Number(sale.bankId);
    if (!(Number.isFinite(bid) && bid > 0)) return { ok:false, msg:`Venta inválida: falta banco para ${getPaymentMethodLabelPOS(pay)}.` };
  }

  if (pay === 'efectivo' && String(sale.cashTenderMode || '').toUpperCase() === 'USD_CHANGE_NIO'){
    const fx = Number(sale.fxUsed ?? sale.exchangeRateUsed);
    const usd = Number(sale.usdReceived ?? sale.receivedUSD);
    const eq = Number(sale.equivalentC ?? sale.equivalentNIO);
    const ch = Number(sale.changeC ?? sale.changeNIO);
    if (!(Number.isFinite(fx) && fx > 0)) return { ok:false, msg:'Venta inválida: T/C usado inválido.' };
    if (!(Number.isFinite(usd) && usd > 0)) return { ok:false, msg:'Venta inválida: USD recibido inválido.' };
    if (!(Number.isFinite(eq) && eq >= total - 0.000001)) return { ok:false, msg:'Venta inválida: equivalente C$ insuficiente.' };
    if (!(Number.isFinite(ch) && ch >= -0.000001)) return { ok:false, msg:'Venta inválida: vuelto C$ inválido.' };
  }

  const costPU = Number(sale.costPerUnit);
  if (!Number.isFinite(costPU) || costPU < 0) return { ok:false, msg:'Venta inválida: costo unitario inválido.' };
  const lineCost = Number(sale.lineCost);
  if (!Number.isFinite(lineCost)) return { ok:false, msg:'Venta inválida: costo de línea inválido.' };
  if (!isReturn && lineCost < -0.00001) return { ok:false, msg:'Venta inválida: costo negativo.' };
  const lineProfit = Number(sale.lineProfit);
  if (!Number.isFinite(lineProfit)) return { ok:false, msg:'Venta inválida: ganancia inválida.' };

  return { ok:true, msg:'' };
}



// --- Etapa 4: Guardas duras FIFO/Lotes (sin NaN/negativos silenciosos)
function numFinitePOS(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nonNegPOS(v){
  const n = numFinitePOS(v);
  return n < 0 ? 0 : n;
}

function validateLotFifoIntegrityPOS(fifo, evId){
  try{
    if (!fifo || typeof fifo !== 'object') return { ok:false, msg:'FIFO/Lotes: no se pudo leer el estado de lotes.' };
    const eid = Number(fifo.eventId);
    if (Number.isFinite(evId) && evId > 0 && Number.isFinite(eid) && eid > 0 && eid !== Number(evId)){
      // Evitar contaminar otro evento por referencias cruzadas.
      return { ok:false, msg:'FIFO/Lotes: evento inválido (aislamiento).' };
    }

    const lotsMap = (fifo.lots && typeof fifo.lots === 'object') ? fifo.lots : {};
    const keys = Array.isArray(fifo.keys) ? fifo.keys : ['P','M','D','L','G'];

    const chkMap = (m)=>{
      if (!m) return true;
      for (const k of keys){
        const v = m[k];
        if (v == null) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) return false;
        if (n < -0.000001) return false;
      }
      return true;
    };

    for (const lk of Object.keys(lotsMap)){
      const l = lotsMap[lk];
      if (!l) continue;
      if (!chkMap(l.loadedByKey)) return { ok:false, msg:'FIFO/Lotes: detecté cantidades inválidas en carga.' };
      if (!chkMap(l.soldByKey)) return { ok:false, msg:'FIFO/Lotes: detecté cantidades inválidas en ventas.' };
      if (!chkMap(l.remainingByKey)) return { ok:false, msg:'FIFO/Lotes: detecté cantidades inválidas en remaining.' };
      const st = Number(l.soldTotal);
      const rt = Number(l.remainingTotal);
      if (!Number.isFinite(st) || st < -0.000001) return { ok:false, msg:'FIFO/Lotes: soldTotal inválido.' };
      if (!Number.isFinite(rt) || rt < -0.000001) return { ok:false, msg:'FIFO/Lotes: remainingTotal inválido.' };
    }
    let totS = Number(fifo.soldTotal);
    let totR = Number(fifo.remainingTotal);
    // Hotfix Etapa 4: si el snapshot no trae totales, los calculamos desde los lotes.
    if (!Number.isFinite(totS) || !Number.isFinite(totR)){
      totS = 0;
      totR = 0;
      for (const lk of Object.keys(lotsMap)){
        const l = lotsMap[lk];
        if (!l) continue;
        totS += Math.max(0, Number(l.soldTotal) || 0);
        totR += Math.max(0, Number(l.remainingTotal) || 0);
      }
    }
    if (!Number.isFinite(totS) || totS < -0.000001) return { ok:false, msg:'FIFO/Lotes: total vendido inválido.' };
    if (!Number.isFinite(totR) || totR < -0.000001) return { ok:false, msg:'FIFO/Lotes: total restante inválido.' };

    return { ok:true, msg:'' };
  }catch(e){
    return { ok:false, msg:'FIFO/Lotes: error verificando integridad.' };
  }
}

function lotTotalsForKeyPOS(fifo, presKey){
  const key = String(presKey || '').trim();
  if (!key) return { loaded:0, remaining:0 };
  const lotsMap = (fifo && fifo.lots && typeof fifo.lots === 'object') ? fifo.lots : {};
  const order = Array.isArray(fifo && fifo.lotOrder) ? fifo.lotOrder : Object.keys(lotsMap);
  let loaded = 0;
  let remaining = 0;
  for (const lk of order){
    const l = lotsMap[lk];
    if (!l) continue;
    loaded += nonNegPOS(l.loadedByKey && l.loadedByKey[key]);
    remaining += nonNegPOS(l.remainingByKey && l.remainingByKey[key]);
  }
  return { loaded, remaining };
}

function lotesPOSContractRowsPOS(lote){
  if (!lote || typeof lote !== 'object') return [];
  const candidates = [];
  if (Array.isArray(lote.disponibilidadPOS)) candidates.push(lote.disponibilidadPOS);
  if (lote.salidaPOS && Array.isArray(lote.salidaPOS.productos)) candidates.push(lote.salidaPOS.productos);
  if (Array.isArray(lote.productosProducidos)) candidates.push(lote.productosProducidos);
  if (Array.isArray(lote.productosDinamicos)) candidates.push(lote.productosDinamicos);
  if (Array.isArray(lote.productos)) candidates.push(lote.productos);
  if (Array.isArray(lote.itemsProducidos)) candidates.push(lote.itemsProducidos);
  for (const arr of candidates){
    const clean = (arr || []).filter(x => x && typeof x === 'object');
    if (clean.length) return clean;
  }
  return [];
}

function lotesPOSQtyFromContractRowPOS(row){
  if (!row || typeof row !== 'object') return 0;
  const preferred = [
    row.cantidadDisponible,
    row.disponible,
    row.remaining,
    row.cantidadRestante,
    row.cantidadProducida,
    row.cantidad,
    row.unidades,
    row.qty,
    row.quantity
  ];
  for (const v of preferred){
    if (v == null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'pendiente') continue;
    const n = Number(String(v).replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function resolveProductFromLoteContractRowPOS(row, products){
  const list = Array.isArray(products) ? products : [];
  const normLocal = s => (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const rawPid = String(row && (row.productId ?? row.productoId ?? row.id) || '').trim();
  if (rawPid){
    const byId = list.find(p => p && String(p.id) === rawPid);
    if (byId) return byId;
  }

  const letter = String(row && (row.Letra ?? row.letra ?? row.letter) || '').trim().toUpperCase();
  if (letter){
    const byLetter = list.find(p => p && String(p.letra ?? p.Letra ?? p.letter ?? '').trim().toUpperCase() === letter);
    if (byLetter) return byLetter;
  }

  const legacyId = String(row && (row.legacyId ?? row.legacyField ?? row.field) || '').trim().toLowerCase();
  if (legacyId){
    const byLegacy = list.find(p => p && mapProductNameToFinishedId(p.name || p.nombre || '') === legacyId);
    if (byLegacy) return byLegacy;
  }

  const name = String(row && (row.nombreSnapshot ?? row.nombre ?? row.name ?? row.productName) || '').trim();
  if (name){
    const n = normLocal(name);
    const exact = list.find(p => p && normLocal(p.name || p.nombre || '') === n);
    if (exact) return exact;
    const legacyFromName = mapProductNameToFinishedId(name);
    if (legacyFromName){
      const byNameLegacy = list.find(p => p && mapProductNameToFinishedId(p.name || p.nombre || '') === legacyFromName);
      if (byNameLegacy) return byNameLegacy;
    }
  }

  return null;
}

async function guardLotAvailabilityBeforeSalePOS(eventId, productName, qty, productId, productObj){
  const recipeEnabled = productRecipeEnabledForProductionPOS(productObj || { name: productName });

  // Productos vendibles sin Receta (ej. Vaso) no pasan por Lotes/FIFO.
  // POS solo valida Activo/POS/Precio/Stock; Reempaque alimenta su stock antes de vender.
  if (!recipeEnabled){
    return { ok:true, presKey:'', nonRecipe:true };
  }

  const key = lotFifoKeyFromProductPOS(productObj || null, productId, productName);
  if (!key) return { ok:true, presKey:'' };

  try{
    const fifo = await computeLotFifoForEvent(eventId);
    const v = validateLotFifoIntegrityPOS(fifo, eventId);
    if (!v.ok) return { ok:false, presKey:key, msg: v.msg };

    const totals = lotTotalsForKeyPOS(fifo, key);

    // Legacy mantiene el candado histórico. Productos nuevos por PID solo se amarran a Lotes
    // si realmente existe carga/asignación por ese PID; si no, los valida el inventario por evento.
    const isDynamicPidKey = String(key).startsWith('PID:');
    if (isDynamicPidKey && !(totals.loaded > 0)){
      return { ok:true, presKey:key, dynamic:true, warn:false, remaining:0, faltan:0 };
    }

    // A) Sin lotes asignados / disponibles
    if (!(totals.loaded > 0) || !(totals.remaining > 0)){
      return { ok:false, presKey:key, msg:'No hay lotes asignados a este evento para vender esta presentación.' };
    }

    // B) Excede remaining disponible
    if (Number(qty) > totals.remaining){
      const faltan = Math.max(0, Number(qty) - totals.remaining);
      return { ok:true, presKey:key, warn:true, remaining: totals.remaining, faltan };
    }

    return { ok:true, presKey:key, warn:false, remaining: totals.remaining, faltan:0 };
  }catch(e){
    console.warn('guardLotAvailabilityBeforeSalePOS failed', e);
    return { ok:false, presKey:key, msg:'No se pudo verificar lotes/FIFO para esta venta. Revisa tus lotes asignados e intenta de nuevo.' };
  }
}
function reserveSaleSeqInMemoryPOS(event, saleRecord, salesForEvent){
  // Etapa 2C: NO avanzar contadores del evento antes de confirmar persistencia.
  // Calcula el próximo seqId y devuelve un eventUpdated para persistir en la misma transacción.
  try{
    if (!event || !saleRecord) return { nextSeq:null, eventUpdated:event || null };

    let curSeq = Number(event.saleSeq || 0);
    if (!Number.isFinite(curSeq) || curSeq <= 0){
      const base = computeEventSaleSeqBasePOS(Array.isArray(salesForEvent) ? salesForEvent : []);
      curSeq = Number.isFinite(base) ? base : 0;
    }

    const next = curSeq + 1;
    saleRecord.seqId = next;

    // Importante: NO mutar `event` aquí. Solo devolvemos el patch para persistir.
    const eventUpdated = Object.assign({}, event, { saleSeq: next });
    return { nextSeq: next, eventUpdated };
  }catch(_){
    return { nextSeq:null, eventUpdated:event || null };
  }
}


// Guardar venta + actualizar contador del evento en una sola transacción (sales + events)
async function saveSaleAndEventAtomicPOS({ saleRecord, eventUpdated }){
  if (!db) await openDB();
  return await new Promise((resolve, reject)=>{
    let done = false;
    const ok = (id)=>{ if (done) return; done = true; resolve(id); };
    const fail = (err)=>{ if (done) return; done = true; reject(err); };
    try{
      const tr = db.transaction(['sales','events'], 'readwrite');
      const sStore = tr.objectStore('sales');
      const eStore = tr.objectStore('events');

      let saleId = null;

      tr.oncomplete = ()=> ok(saleId);
      tr.onabort = ()=> fail(tr.error || new Error('Transacción abortada (venta).'));
      tr.onerror = ()=> fail(tr.error || new Error('Error de transacción (venta).'));

      const reqSale = (saleRecord && saleRecord.id != null) ? sStore.put(saleRecord) : sStore.add(saleRecord);
      reqSale.onsuccess = ()=>{ saleId = reqSale.result; };
      reqSale.onerror = ()=>{ try{ tr.abort(); }catch(_){ } };

      const reqEv = eStore.put(eventUpdated);
      reqEv.onerror = ()=>{ try{ tr.abort(); }catch(_){ } };
    }catch(err){
      fail(err);
    }
  });
}

// Guardar cierre diario + candado (dailyClosures + dayLocks) en una sola transacción
async function saveDailyClosureAndLockAtomicPOS({ closureRecord, lockKey, lockPatch, eventId, dateKey }){
  if (!db) await openDB();
  return await new Promise((resolve, reject)=>{
    let done = false;
    const ok = (payload)=>{ if (done) return; done = true; resolve(payload); };
    const fail = (err)=>{ if (done) return; done = true; reject(err); };
    try{
      const tr = db.transaction(['dailyClosures','dayLocks'], 'readwrite');
      const cStore = tr.objectStore('dailyClosures');
      const lStore = tr.objectStore('dayLocks');

      let lockSaved = null;

      const makeAbortErr = (raw)=>{
        const detail = raw ? (raw.message || raw.name || String(raw)) : '';
        const e = new Error('Transacción abortada (cierre diario). Rollback OK: no se guardó ni el cierre ni el candado.' + (detail ? (' Detalle: ' + detail) : ''));
        e.name = 'A33AtomicAbort';
        try{ e.code = 'ATOMIC_ABORT'; }catch(_){ }
        try{ e.cause = raw; }catch(_){ }
        return e;
      };

      tr.oncomplete = ()=> ok({ lock: lockSaved, closure: closureRecord });
      tr.onabort = ()=> fail(makeAbortErr(tr.error));
      tr.onerror = ()=> fail(tr.error || new Error('Error de transacción (cierre diario).'));

      // Etapa 3: NO sobreescribir cierres ya existentes. Si ya existe (mismo key o mismo evento+día+versión), debe fallar.
      const rc = cStore.add(closureRecord);
      rc.onerror = ()=>{ try{ tr.abort(); }catch(_){ } };

      // Etapa 5: asegurar orden explícito: primero dailyClosures, luego dayLocks.
      rc.onsuccess = ()=>{
        const rget = lStore.get(lockKey);
        rget.onerror = ()=>{ try{ tr.abort(); }catch(_){ } };
        rget.onsuccess = ()=>{
          const cur = rget.result;
          const base = (cur && typeof cur === 'object') ? cur : { key: lockKey, eventId:Number(eventId), dateKey: safeYMD(dateKey) };
          const next = { ...base, ...(lockPatch || {}), key: lockKey, eventId:Number(eventId), dateKey: safeYMD(dateKey), updatedAt: Date.now() };
          lockSaved = next;
          const rput = lStore.put(next);
          rput.onerror = ()=>{ try{ tr.abort(); }catch(_){ } };
        };
      };
    }catch(err){
      fail(err);
    }
  });
}


function setOfflineBar(){ const ob=$('#offlineBar'); if (!ob) return; ob.style.display = navigator.onLine?'none':'block'; }
window.addEventListener('online', setOfflineBar);
window.addEventListener('offline', setOfflineBar);

// Enable/disable selling block depending on current event
// + Candado por día/evento (Sección o Resumen): si el día está cerrado, NO se puede vender (UI + guard en lógica)
let __A33_SELL_STATE = { enabled:false, dayKey: todayYMD(), dayClosed:false, eventId:null, closeVersion:null, closeSource:null };

function getSaleDayKeyPOS(){
  try{
    const v = document.getElementById('sale-date')?.value || '';
    return safeYMD(v);
  }catch(e){
    return todayYMD();
  }
}

function isSellEnabledNowPOS(){
  try{
    if (typeof window.__A33_SELL_ENABLED === 'boolean') return !!window.__A33_SELL_ENABLED;
    if (typeof __A33_SELL_STATE === 'object' && __A33_SELL_STATE) return !!__A33_SELL_STATE.enabled;
    return true;
  }catch(e){ return true; }
}

function showSellDayClosedToastPOS(reopenHint){
  const hint = (reopenHint || '').trim();
  const msg = hint ? `Día cerrado. ${hint}` : 'Día cerrado. Reabrí el día para vender.';
  showToast(msg, 'error', 5000);
}

function makeDayLockKeyPOS(eventId, dateKey){
  return `${Number(eventId)}|${safeYMD(dateKey)}`;
}

function makeDailyClosureKeyPOS(eventId, dateKey, version){
  return `${Number(eventId)}|${safeYMD(dateKey)}|v${Number(version)}`;
}

function genClosureIdPOS(){
  return 'DC-' + Date.now() + '-' + Math.random().toString(16).slice(2,10);
}

async function getDayLockRecordPOS(eventId, dateKey){
  try{
    const key = makeDayLockKeyPOS(eventId, dateKey);
    return await new Promise((res, rej)=>{
      const r = tx('dayLocks').get(key);
      r.onsuccess = ()=>res(r.result || null);
      r.onerror = ()=>rej(r.error);
    });
  }catch(e){
    return null;
  }
}

async function upsertDayLockPOS(eventId, dateKey, patch){
  const dk = safeYMD(dateKey);
  const key = makeDayLockKeyPOS(eventId, dk);
  const cur = await getDayLockRecordPOS(eventId, dk);
  const base = (cur && typeof cur === 'object') ? cur : { key, eventId:Number(eventId), dateKey:dk };
  const next = { ...base, ...patch, key, eventId:Number(eventId), dateKey:dk, updatedAt: Date.now() };
  await put('dayLocks', next);
  return next;
}

function isCourtesySalePOS(s){
  return !!(s && (s.courtesy || s.isCourtesy));
}

function getSaleLineCostPOS(s){
  return getSaleLineCostSnapshotPOS(s);
}

async function computeDailySnapshotFromSalesPOS(eventId, dateKey){
  const dk = safeYMD(dateKey);
  const sales = await getAll('sales');
  const filtered = sales.filter(s => s && Number(s.eventId) === Number(eventId) && String(s.date || '') === dk);

  const byPay = {};
  let grand = 0;
  let gross = 0;
  let discountTotal = 0;
  let courtesyValue = 0;
  let courtesyQty = 0;
  let returnTotal = 0;
  let returnQty = 0;
  let paidQty = 0;

  // Costos (COGS): solo si existe snapshot/costo confiable; no se inventa por nombre fijo.
  let paidCost = 0;
  let courtesyCost = 0;

  const breakdownMap = new Map();

  const baseName = (name) => {
    const bn = String(name || '')
      .replace(/\s*\(Cortes[ií]a\)\s*$/i, '')
      .trim();
    return uiProductNamePOS(bn);
  };
  const saleName = (sale) => baseName(getSaleProductNameSnapshotPOS(sale) || (sale && (sale.productName || sale.name || sale.producto || sale.product)) || '');

  const isA33CostableSale = (s) => {
    if (!s || s.isExtra) return false;
    if (s.vaso === true) return true;
    const bn = saleName(s);
    if (mapProductNameToPresId(bn)) return true;
    const lineCost = getSaleLineCostSnapshotPOS(s);
    const hasCostSnapshot = Math.abs(Number(lineCost || 0)) > 1e-9 || getSaleCostUnitSnapshotPOS(s) > 0;
    const hasDynamicProductId = saleProductIdForInventoryPOS(s) != null;
    return !!(hasCostSnapshot || hasDynamicProductId);
  };

  const addBreakdown = (s, isCourtesy, lineCost) => {
    const qty = Number(s.qty || 0);
    const nm = saleName(s);
    const key = String((s && (s.productId ?? s.productoId ?? (s.productSnapshot && (s.productSnapshot.productId ?? s.productSnapshot.id)))) || nm || 'unknown').trim();
    if (!key) return;

    if (!breakdownMap.has(key)) {
      breakdownMap.set(key, {
        productId: (s.productId != null) ? s.productId : (s.productoId != null ? s.productoId : null),
        productName: nm || getSaleProductNameSnapshotPOS(s) || String(s.productName || ''),
        qtyPaid: 0,
        qtyCourtesy: 0,
        totalCostPaid: 0,
        totalCostCourtesy: 0,
        _unitCostWeight: 0,
        _unitCostQty: 0
      });
    }

    const b = breakdownMap.get(key);
    if (isCourtesy) {
      b.qtyCourtesy += qty;
      b.totalCostCourtesy += Number(lineCost || 0);
    } else {
      b.qtyPaid += qty;
      b.totalCostPaid += Number(lineCost || 0);
    }

    // UnitCost (auditoría): preferimos snapshot económico guardado en la venta.
    let unitCost = getSaleCostUnitSnapshotPOS(s);
    if (!(unitCost > 0) && qty) {
      unitCost = Math.abs(Number(lineCost || 0) / Number(qty || 1));
    }
    const qAbs = Math.abs(qty || 0);
    if (unitCost > 0 && qAbs > 0) {
      b._unitCostWeight += (unitCost * qAbs);
      b._unitCostQty += qAbs;
    }
  };

  for (const s of filtered){
    const courtesy = isCourtesySalePOS(s);
    const total = Number(s.total || 0);
    const qty = Number(s.qty || 0);
    const absQty = Math.abs(qty || 0);
    const unitPrice = getSaleUnitPriceSnapshotPOS(s);
    const discountLine = getSaleDiscountTotalPOS(s) * ((s.isReturn || qty < 0) ? -1 : 1);
    gross += round2((unitPrice || 0) * absQty * ((s.isReturn || qty < 0) ? -1 : 1));
    discountTotal += round2(discountLine);
    if (s.isReturn || qty < 0){ returnQty += absQty; returnTotal += Math.abs(total || 0); }

    // Cortesías: no generan ingresos, pero sí consumen costo.
    if (courtesy){
      courtesyQty += absQty;
      courtesyValue += round2((unitPrice || 0) * absQty * ((s.isReturn || qty < 0) ? -1 : 1));
    } else {
      paidQty += absQty;
      const pay = normalizePaymentMethodPOS(s.payment || '') || 'otros';
      byPay[pay] = (byPay[pay] || 0) + total;
      grand += total;
    }

    // Costos: solo si podemos calcularlos sin inventar.
    if (isA33CostableSale(s)) {
      const lineCost = Number(getSaleLineCostPOS(s) || 0);
      if (courtesy) courtesyCost += lineCost;
      else paidCost += lineCost;
      addBreakdown(s, courtesy, lineCost);
    }
  }

  const costBreakdown = Array.from(breakdownMap.values()).map(b => {
    const unitCost = (b._unitCostQty > 0) ? round2(b._unitCostWeight / b._unitCostQty) : 0;
    return {
      productId: b.productId,
      productName: b.productName,
      qtyPaid: b.qtyPaid,
      qtyCourtesy: b.qtyCourtesy,
      unitCost,
      totalCostPaid: round2(b.totalCostPaid),
      totalCostCourtesy: round2(b.totalCostCourtesy)
    };
  }).sort((a,b)=> String(a.productName||'').localeCompare(String(b.productName||'')));

  const costoVentasTotal = round2(paidCost);
  const costoCortesiasTotal = round2(courtesyCost);
  const costoTotalSalidaInventario = round2(costoVentasTotal + costoCortesiasTotal);

  const ventaBruta = round2(gross);
  const ventaNeta = round2(grand);
  const utilidadBruta = round2(ventaNeta - costoVentasTotal);
  const utilidadNetaOperativa = round2(utilidadBruta - costoCortesiasTotal);

  return {
    dayKey: dk,
    ventasPorMetodo: byPay,
    totalGeneral: grand,
    ventaBruta,
    descuentosTotal: round2(discountTotal),
    ventaNeta,
    utilidadBruta,
    utilidadNetaOperativa,
    cortesiaCantidad: courtesyQty,
    cortesiaValorReferencia: round2(courtesyValue),
    devolucionCantidad: returnQty,
    devolucionValor: round2(returnTotal),
    // Compat legacy
    cortesiaCostoTotal: costoCortesiasTotal,
    // Nuevo esquema de costos
    costoVentasTotal,
    costoCortesiasTotal,
    costoTotalSalidaInventario,
    costBreakdown,
    counts: { totalSales: filtered.length, paidQty, courtesyQty, returnQty, dynamicProducts: costBreakdown.filter(x => x && x.productId != null).length }
  };
}

async function listDailyClosuresForDayPOS(eventId, dateKey){
  try{
    const dk = safeYMD(dateKey);
    const all = await getAll('dailyClosures');
    return (all || []).filter(r => r && Number(r.eventId) === Number(eventId) && String(r.dateKey || '') === dk)
      .sort((a,b)=> (Number(a.version||0) - Number(b.version||0)));
  }catch(e){
    return [];
  }
}

async function getMaxDailyClosureVersionPOS(eventId, dateKey){
  const list = await listDailyClosuresForDayPOS(eventId, dateKey);
  let maxV = 0;
  for (const r of list) maxV = Math.max(maxV, Number(r.version || 0));
  return maxV;
}

async function getDailyClosureByKeyPOS(key){
  try{
    return await new Promise((res, rej)=>{
      const r = tx('dailyClosures').get(key);
      r.onsuccess = ()=>res(r.result || null);
      r.onerror = ()=>rej(r.error);
    });
  }catch(e){
    return null;
  }
}

// --- POS→Finanzas (Etapa 2): Sección se consolida dentro del cierre diario (POS_DAILY_CLOSE)
// Candado en memoria (mínimo) para evitar doble click / doble ejecución del mismo cierre.
// La unicidad final la impone IndexedDB (store + índice), pero esto reduce carreras y compute duplicado.
function validateDailyClosureBeforePersistPOS({ record, lockPatch }){
  if (!record || typeof record !== 'object') return { ok:false, msg:'Cierre inválido.' };

  const evId = Number(record.eventId);
  if (!(Number.isFinite(evId) && evId > 0)) return { ok:false, msg:'Cierre inválido: falta eventId.' };

  const dk = String(record.dateKey || '');
  if (!isValidYmdCalendarPOS(dk)) return { ok:false, msg:'Cierre inválido: dateKey inválido (YYYY-MM-DD).' };

  const v = Number(record.version);
  if (!(Number.isFinite(v) && v > 0)) return { ok:false, msg:'Cierre inválido: versión inválida.' };

  const t = (record.totals && typeof record.totals === 'object') ? record.totals : null;
  if (!t) return { ok:false, msg:'Cierre inválido: totales faltantes.' };

  const grand = Number(t.totalGeneral);
  if (!Number.isFinite(grand)) return { ok:false, msg:'Cierre inválido: totalGeneral inválido.' };

  const byPay = (t.ventasPorMetodo && typeof t.ventasPorMetodo === 'object') ? t.ventasPorMetodo : null;
  if (!byPay) return { ok:false, msg:'Cierre inválido: ventasPorMetodo inválido.' };
  for (const [k,val] of Object.entries(byPay)){
    const n = Number(val);
    if (!Number.isFinite(n)) return { ok:false, msg:`Cierre inválido: ventasPorMetodo(${k}) inválido.` };
  }

  const cq = Number(t.cortesiaCantidad);
  if (!Number.isFinite(cq) || cq < -0.00001) return { ok:false, msg:'Cierre inválido: cortesías inválidas.' };

  const optionalNums = ['ventaBruta','descuentosTotal','ventaNeta','utilidadBruta','utilidadNetaOperativa','cortesiaValorReferencia','devolucionCantidad','devolucionValor'];
  for (const k of optionalNums){
    if (t[k] == null) continue;
    const n = Number(t[k]);
    if (!Number.isFinite(n)) return { ok:false, msg:`Cierre inválido: ${k} inválido.` };
  }

  // Costos: permitir negativos si hubo devoluciones (reversos), pero jamás NaN
  const c1 = Number(t.costoVentasTotal);
  const c2 = Number(t.costoCortesiasTotal);
  const c3 = Number(t.costoTotalSalidaInventario);
  if (!Number.isFinite(c1)) return { ok:false, msg:'Cierre inválido: costoVentasTotal inválido.' };
  if (!Number.isFinite(c2)) return { ok:false, msg:'Cierre inválido: costoCortesiasTotal inválido.' };
  if (!Number.isFinite(c3)) return { ok:false, msg:'Cierre inválido: costoTotalSalidaInventario inválido.' };

  if (lockPatch && typeof lockPatch === 'object'){
    const lv = Number(lockPatch.lastClosureVersion);
    if (!(Number.isFinite(lv) && lv > 0)) return { ok:false, msg:'Cierre inválido: candado inválido.' };
  }

  return { ok:true, msg:'' };
}

const __A33_DAILY_CLOSE_MUTEX = new Set();

async function closeDailyPOS({ event, dateKey, source }){
  if (!event || event.id == null) throw new Error('No hay evento válido para cerrar el día.');
  const eventId = Number(event.id);
  const dk = normalizeDateKeyForClosePOS(dateKey);
  if (!dk) throw new Error('dateKey inválido para cierre. Usa formato YYYY-MM-DD.');
  // Nota: el cierre oficial se ejecuta desde Resumen.
  // Si Sección está activa, Resumen valida registro de cierre + cuadratura antes de llamar a este método.

  // Idempotencia: si el día ya está marcado como cerrado, devolvemos el último estado.
  const curLock = await getDayLockRecordPOS(eventId, dk);
  if (curLock && curLock.isClosed){
    const lastKey = (curLock.lastClosureKey || (curLock.lastClosureVersion ? makeDailyClosureKeyPOS(eventId, dk, curLock.lastClosureVersion) : null));
    const last = lastKey ? await getDailyClosureByKeyPOS(lastKey) : null;
    if (!last){
      posBlockingAlert('Inconsistencia: el día está marcado como CERRADO pero no se encontró el cierre guardado. Reabrí el día y volvé a cerrarlo para regenerar el cierre (v+1).');
    }
    return {
      already:true,
      reason:'ALREADY_CLOSED',
      hint:'Día ya cerrado. Reabrí el día si necesitás generar un nuevo cierre (v+1).',
      lock: curLock,
      closure: last,
      closureKey: lastKey || null,
      lastClosureKey: lastKey || null
    };
  }

  const mutexKey = `${eventId}|${dk}`;
  if (__A33_DAILY_CLOSE_MUTEX.has(mutexKey)){
    throw new Error('Cierre en progreso para este evento/día. Esperá y reintentá.');
  }
  __A33_DAILY_CLOSE_MUTEX.add(mutexKey);

  let version = null;
  let key = null;

  try{
    const maxV = await getMaxDailyClosureVersionPOS(eventId, dk);
    version = maxV + 1;

    key = makeDailyClosureKeyPOS(eventId, dk, version);
    const dup = await getDailyClosureByKeyPOS(key);
    if (dup){
      try{ if (typeof showToast === 'function') showToast('Cierre ya guardado (duplicado bloqueado).', 'error', 4500); else alert('Cierre ya guardado (duplicado bloqueado).'); }catch(_){ try{ alert('Cierre ya guardado (duplicado bloqueado).'); }catch(__){ } }
      return { already:true, lock: await getDayLockRecordPOS(eventId, dk), closure: dup, duplicate:true };
    }

  const snapshot = await computeDailySnapshotFromSalesPOS(eventId, dk);

  const closureId = genClosureIdPOS();
  const createdAt = Date.now();

  const record = {
    key,
    closureId,
    eventId,
    eventNameSnapshot: String(event.name || ''),
    dateKey: dk,
    version,
    createdAt,
    createdBy: null,
    source: String(source || 'SUMMARY').toUpperCase(),
    totals: {
      ventasPorMetodo: snapshot.ventasPorMetodo,
      totalGeneral: snapshot.totalGeneral,
      ventaBruta: snapshot.ventaBruta,
      descuentosTotal: snapshot.descuentosTotal,
      ventaNeta: snapshot.ventaNeta,
      utilidadBruta: snapshot.utilidadBruta,
      utilidadNetaOperativa: snapshot.utilidadNetaOperativa,
      cortesiaCantidad: snapshot.cortesiaCantidad,
      cortesiaValorReferencia: snapshot.cortesiaValorReferencia,
      devolucionCantidad: snapshot.devolucionCantidad,
      devolucionValor: snapshot.devolucionValor,
      // Compat legacy
      cortesiaCostoTotal: snapshot.cortesiaCostoTotal,
      // Nuevo esquema de costos
      costoVentasTotal: snapshot.costoVentasTotal,
      costoCortesiasTotal: snapshot.costoCortesiasTotal,
      costoTotalSalidaInventario: snapshot.costoTotalSalidaInventario,
      // (Opcional) auditoría: desglose por producto/presentación
      costBreakdown: snapshot.costBreakdown,
    },
    meta: {
      counts: snapshot.counts,
    }
  };

  const lockKey = makeDayLockKeyPOS(eventId, dk);
  const lockPatch = {
    isClosed: true,
    eventNameSnapshot: String(event.name || ''),
    closedAt: createdAt,
    closedSource: String(source || 'SUMMARY').toUpperCase(),
    lastClosureVersion: version,
    lastClosureId: closureId,
    lastClosureKey: key
  };

    const vHard = validateDailyClosureBeforePersistPOS({ record, lockPatch });
    if (!vHard.ok) throw a33ValidationErrorPOS(vHard.msg);

    const saved = await saveDailyClosureAndLockAtomicPOS({
      closureRecord: record,
      lockKey,
      lockPatch,
      eventId,
      dateKey: dk
    });

    // Readback robusto (Etapa 5): verificar coherencia closureKey vs lastClosureKey
    let lockNow = null;
    let closureNow = null;
    try{ lockNow = await getDayLockRecordPOS(eventId, dk); }catch(_){ lockNow = null; }
    try{ closureNow = await getDailyClosureByKeyPOS(key); }catch(_){ closureNow = null; }

    const lastK = (lockNow && lockNow.lastClosureKey) ? lockNow.lastClosureKey : (saved && saved.lock && saved.lock.lastClosureKey ? saved.lock.lastClosureKey : key);
    const coherent = !!(lockNow && lockNow.isClosed && String(lastK||'') === String(key||'') && closureNow && String(closureNow.key||'') === String(key||''));

    if (!coherent){
      try{ posBlockingAlert('Advertencia: el cierre se guardó, pero la confirmación de lectura no cuadra (closureKey/lastClosureKey). Revisá “Estado técnico” en Resumen. Si necesitás regenerar, reabrí el día y volvé a cerrar.'); }catch(_){ }
    }

    return {
      already:false,
      coherent,
      lock: lockNow || (saved ? saved.lock : null),
      closure: closureNow || record,
      closureKey: key,
      lastClosureKey: lastK
    };
  }catch(err){
    console.error('closeDailyPOS persist error', err);

    // Etapa 3: idempotencia mínima.
    // Si el cierre ya existe (doble click / race / pestañas), NO creamos otro ni sobreescribimos.
    if (err && String(err.name || '') === 'ConstraintError'){
      let lockNow = null;
      let existing = null;
      try{ lockNow = await getDayLockRecordPOS(eventId, dk); }catch(_){ }
      try{ existing = await getDailyClosureByKeyPOS(key); }catch(_){ }
      // Fallback: buscar por versión en el día (por si el key legacy no coincide)
      if (!existing){
        try{
          const list = await listDailyClosuresForDayPOS(eventId, dk);
          existing = (Array.isArray(list) ? list : []).find(c => c && Number(c.version || 0) === Number(version));
        }catch(_){ }
      }
      return { already:true, lock: lockNow || null, closure: existing || null, duplicate:true };
    }

    showPersistFailPOS('cierre diario', err);
    throw err;
  } finally {
    __A33_DAILY_CLOSE_MUTEX.delete(mutexKey);
  }
}

async function reopenDailyPOS({ event, dateKey, source }){
  if (!event || event.id == null) throw new Error('No hay evento válido para reabrir el día.');
  const eventId = Number(event.id);
  const dk = normalizeDateKeyForClosePOS(dateKey);
  if (!dk) throw new Error('dateKey inválido para reabrir. Usa formato YYYY-MM-DD.');
  // Nota: reapertura unificada desde Resumen (Sección ya no es la puerta de cierre).

  const curLock = await getDayLockRecordPOS(eventId, dk);
  if (curLock && !curLock.isClosed){
    return { already:true, lock: curLock };
  }

  let lock;
  try{
    lock = await upsertDayLockPOS(eventId, dk, {
      isClosed: false,
      reopenedAt: Date.now(),
      reopenedSource: String(source || 'SUMMARY').toUpperCase()
    });
  }catch(err){
    console.error('reopenDailyPOS persist error', err);
    showPersistFailPOS('reabrir día', err);
    throw err;
  }

  return { already:false, lock };
}

function setSellControlsDisabledPOS(disabled){
  const tab = document.getElementById('tab-venta');
  if (tab) tab.classList.toggle('sell-locked', !!disabled);

  const ids = [
    'sale-product','sale-price','sale-qty','qty-minus','qty-plus','sale-discount',
    'sale-payment','sale-bank','sale-courtesy','sale-return','sale-customer','sale-courtesy-to','sale-notes',
    'btn-add','btn-add-sticky','btn-undo'
  ];
  for (const id of ids){
    const el = document.getElementById(id);
    if (el) el.disabled = !!disabled;
  }

  // Chips (productos + extras)
  document.querySelectorAll('#product-chips button.chip').forEach(btn=>{
    btn.disabled = !!disabled;
    btn.classList.toggle('disabled', !!disabled);
  });

  // Botones borrar en tabla del día
  document.querySelectorAll('#tbl-day button.del-sale').forEach(btn=>{
    btn.disabled = !!disabled;
  });

}

function setSellDayClosedBannerPOS(show, dayKey, reopenHint){
  const banner = document.getElementById('sell-day-closed-banner');
  if (!banner) return;
  if (show){
    const t = document.getElementById('sell-day-closed-title');
    if (t) t.textContent = `Día cerrado (${dayKey})`;
    const s = document.getElementById('sell-day-closed-sub');
    if (s) s.textContent = reopenHint || 'Para vender aquí, reabrí el día.';
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

async function computeSellDayLockPOS(curEvent, dayKey){
  const dk = safeYMD(dayKey || getSaleDayKeyPOS());
  if (!curEvent) return { dayKey: dk, dayClosed:false, closedAt:null, created:false, closeVersion:null, closeSource:null };

  if (curEvent.closedAt){
    // Evento cerrado: no crear ni modificar Sección por rutas indirectas
    return { dayKey: dk, dayClosed:true, closedAt: curEvent.closedAt, created:false, closeVersion:null, closeSource:null };
  }

  const lock = await getDayLockRecordPOS(curEvent.id, dk);
  const isClosedLock = !!(lock && lock.isClosed);

  // Sin Sección
  return {
    dayKey: dk,
    dayClosed: isClosedLock,
    closedAt: lock ? (lock.closedAt || null) : null,
    created:false,
    closeVersion: lock ? (lock.lastClosureVersion || null) : null,
    closeSource: lock ? (lock.closedSource || null) : null
  };
}

async function guardSellDayOpenOrToastPOS(curEvent, dayKey){
  if (!curEvent) return true;
  const info = await computeSellDayLockPOS(curEvent, dayKey);
  if (info.dayClosed){
    showSellDayClosedToastPOS('Reabrí el día en Resumen para vender.');
    try{ await updateSellEnabled(); }catch(e){}
    return false;
  }
  return true;
}

async function updateSellEnabled(){
  const current = await getMeta('currentEventId');
  const evs = await getAll('events');
  const cur = evs.find(e=>e.id===current) || null;

  const hasEvent = !!(current && cur);
  const eventOpen = !!(hasEvent && !cur.closedAt);

  const dayKey = getSaleDayKeyPOS();
  let lockInfo = { dayKey, dayClosed:false, closedAt:null, created:false, closeVersion:null, closeSource:null };
  if (eventOpen && cur) {
    lockInfo = await computeSellDayLockPOS(cur, dayKey);
  }

  const sellEnabled = !!(eventOpen && !lockInfo.dayClosed);

  __A33_SELL_STATE = { enabled: sellEnabled, dayKey: lockInfo.dayKey, dayClosed: lockInfo.dayClosed, eventId: (current || null), closeVersion: lockInfo.closeVersion || null, closeSource: lockInfo.closeSource || null };
  window.__A33_SELL_ENABLED = sellEnabled;

  // Nota "sin evento activo": solo depende del evento (no del día)
  const noActive = document.getElementById('no-active-note');
  if (noActive) noActive.style.display = eventOpen ? 'none' : 'block';

  // Banner: cuando el evento está abierto y el día está cerrado (con o sin Sección)
  // El cierre/reapertura oficial es SOLO desde Resumen (unificado). No mandar al usuario a Sección.
  const hint = 'Para vender aquí, reabrí el día en Resumen.';
  setSellDayClosedBannerPOS(!!(eventOpen && lockInfo.dayClosed), lockInfo.dayKey, hint);

  // Candado real de controles
  setSellControlsDisabledPOS(!sellEnabled);

}

// Normalizar Vaso como producto vendible normal alimentado por Inventario → Reempaque.
async function normalizeVasoProductForReempaquePOS(){
  // Neutralizado: POS no renombra, reactiva, completa ni desactiva productos.
  return { ok:true, skipped:true, reason:'catalogos_productos_fuente_unica' };
}

// Normalizar producto Galón (legacy 3750/3800 ml -> 3720 ml)
async function normalizeLegacyGallonProductPOS(){
  // Neutralizado: cualquier normalización del catálogo corresponde a Catálogos → Productos.
  return { ok:true, skipped:true, reason:'catalogos_productos_fuente_unica' };
}


// Ensure defaults
async function ensureDefaults(){
  // Productos permanece exactamente como fue definido en Catálogos/importación/sincronización.
  // En particular, una lectura vacía continúa vacía al abrir, recargar o actualizar POS.
  const events = await getAll('events');
  if (!events.length){
    for (const ev of DEFAULT_EVENTS) await put('events', {...ev, createdAt:new Date().toISOString()});
  }
  const hasKey = (await getAll('meta')).some(m=>m.id==='currentEventId');
  if (!hasKey){
    const evs = await getAll('events');
    if (evs.length) await setMeta('currentEventId', evs[0].id);
  }

  // Otros catálogos legítimos de POS conservan su inicialización independiente.
  await ensureBanksDefaults();
}

// --- Bancos (transferencias / tarjeta)
// Seed base para catálogo de bancos (se pre-carga solo si el store está vacío)
// Nota: mantener nombres en mayúsculas para consistencia visual y de reportes.
const BANKS_SEED = ['BAC', 'BANPRO', 'LAFISE', 'BDF'];

function normBankName(name){
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePaymentMethodPOS(payment){
  const original = String(payment || '').trim();
  const raw = original.toLowerCase();
  let key = raw;
  try{ key = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }catch(_){ }
  key = key.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (!key) return '';
  if (key === 'cash' || key === 'efectivo') return 'efectivo';
  if (key === 'transferencia' || key === 'transfer' || key === 'transferencias') return 'transferencia';
  if (key === 'tarjeta' || key === 'card') return 'tarjeta';
  if (key === 'credito' || key === 'credito cliente' || key === 'cliente credito' || key === 'fiado') return 'credito';
  return raw;
}

function normalizeBankTypePOS(value){
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'tarjeta' ? 'tarjeta' : 'transferencia';
}

function getBankTypePOS(bank){
  if (!bank || typeof bank !== 'object') return 'transferencia';
  return normalizeBankTypePOS(bank.type || bank.bankType || bank.paymentType || 'transferencia');
}

function getBankTypeLabelPOS(value){
  return normalizeBankTypePOS(value) === 'tarjeta' ? 'Tarjeta' : 'Transferencia';
}

function normalizeBankCommissionPOS(value){
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return round2(n);
}

function getBankCommissionPctPOS(bank){
  if (!bank || typeof bank !== 'object') return 0;
  return normalizeBankCommissionPOS(bank.commissionPct ?? bank.commission ?? bank.feePct ?? 0);
}

function isBankForPaymentPOS(bank, payment){
  const pay = normalizePaymentMethodPOS(payment);
  if (pay !== 'transferencia' && pay !== 'tarjeta') return false;
  return !!bank && bank.isActive !== false && getBankTypePOS(bank) === pay;
}

function isBankPaymentMethodPOS(payment){
  const pay = normalizePaymentMethodPOS(payment);
  return pay === 'transferencia' || pay === 'tarjeta';
}

function getPaymentMethodLabelPOS(payment){
  const pay = normalizePaymentMethodPOS(payment);
  if (pay === 'efectivo') return 'Efectivo';
  if (pay === 'transferencia') return 'Transferencia';
  if (pay === 'tarjeta') return 'Tarjeta';
  if (pay === 'credito') return 'Crédito cliente';
  return String(payment || '').trim();
}

async function getAllBanksSafe(){
  try{ return await getAll('banks'); }catch(e){ return []; }
}

async function ensureBanksDefaults(){
  try{
    let banks = await getAllBanksSafe();
    if (!banks.length){
      const now = new Date().toISOString();
      for (const name of BANKS_SEED){
        const seed = { name, isActive: true, type: 'transferencia', commissionPct: 0, createdAt: now };
        if (wasCatalogSeedDeletedPOS('banks', seed)) continue;
        await put('banks', seed);
      }
      banks = await getAllBanksSafe();
    }

    // Migración suave de campos + normalización mínima (sin romper historial)
    for (const b of banks){
      if (!b) continue;
      let changed = false;
      if (typeof b.isActive === 'undefined'){ b.isActive = true; changed = true; }
      if (!b.createdAt){ b.createdAt = new Date().toISOString(); changed = true; }
      const nextType = getBankTypePOS(b);
      if (b.type !== nextType){ b.type = nextType; changed = true; }
      const nextCommission = nextType === 'tarjeta' ? getBankCommissionPctPOS(b) : 0;
      if (Number(b.commissionPct) !== nextCommission){ b.commissionPct = nextCommission; changed = true; }
      // Normalizar solo LAFISE a mayúsculas (para que quede consistente con los otros)
      if (normBankName(b.name) === 'lafise' && String(b.name).trim() !== 'LAFISE'){
        b.name = 'LAFISE';
        changed = true;
      }
      if (changed) await put('banks', b);
    }
  }catch(err){
    console.error('No se pudo inicializar catálogo de bancos', err);
  }
}

function getSaleBankLabel(sale, bankMap){
  if (!sale || !isBankPaymentMethodPOS(sale.payment)) return '';
  let name = (sale.bankName || '').trim();
  const bid = sale.bankId;
  if (!name && bid != null && bankMap && bankMap.has(Number(bid))){
    name = String(bankMap.get(Number(bid)) || '').trim();
  }
  return name || 'Sin banco';
}

async function refreshSaleBankSelect(){
  const row = document.getElementById('sale-bank-row');
  const sel = document.getElementById('sale-bank');
  const note = document.getElementById('sale-bank-note');
  if (!row || !sel) return;

  const payment = normalizePaymentMethodPOS(document.getElementById('sale-payment')?.value || 'efectivo');
  if (!isBankPaymentMethodPOS(payment)){
    row.style.display = 'none';
    sel.value = '';
    if (note) note.textContent = '';
    return;
  }

  row.style.display = 'block';
  const banks = (await getAllBanksSafe()).filter(b => isBankForPaymentPOS(b, payment));
  banks.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||''), 'es-NI', { sensitivity:'base' }));

  // Mantener selección si aún existe dentro del tipo seleccionado
  const prev = sel.value;

  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '— Selecciona banco —';
  sel.appendChild(opt0);
  for (const b of banks){
    const o = document.createElement('option');
    o.value = String(b.id);
    o.textContent = b.name;
    sel.appendChild(o);
  }
  if (prev && banks.some(b => String(b.id) === String(prev))) sel.value = prev;
  else sel.value = '';

  if (!banks.length){
    if (note) note.textContent = `No hay bancos activos tipo ${getPaymentMethodLabelPOS(payment)}. Agregá uno en Catálogos → Bancos.`;
  } else {
    if (note) note.textContent = '';
  }
}

async function renderBancos(){
  const wrap = document.getElementById('banks-list');
  if (!wrap) return;
  const banks = await getAllBanksSafe();
  if (!banks.length){
    wrap.innerHTML = '<div class="warn">No hay bancos. Agrega al menos uno para usar Transferencia o Tarjeta.</div>';
    return;
  }
  const rows = banks.slice().sort((a,b)=>{
    const aa = (a && a.isActive !== false) ? 0 : 1;
    const bb = (b && b.isActive !== false) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    const ta = getBankTypePOS(a);
    const tb = getBankTypePOS(b);
    if (ta !== tb) return ta.localeCompare(tb, 'es-NI');
    return String(a.name||'').localeCompare(String(b.name||''), 'es-NI', { sensitivity:'base' });
  });

  let html = '<table class="table small bank-table"><thead><tr><th>Banco</th><th>Estado</th><th>Tipo</th><th>Comisión</th><th>Acción</th></tr></thead><tbody>';
  for (const b of rows){
    const active = b && b.isActive !== false;
    const estado = active ? 'Activo' : 'Inactivo';
    const btnTxt = active ? 'Desactivar' : 'Activar';
    const btnClass = active ? 'btn-warn' : 'btn-ok';
    const type = getBankTypePOS(b);
    const commission = type === 'tarjeta' ? getBankCommissionPctPOS(b) : 0;
    html += `<tr data-bank-id="${b.id}">
      <td data-label="Banco"><input class="bank-edit-name" data-id="${b.id}" value="${escapeHtml(b.name||'')}" aria-label="Banco"></td>
      <td data-label="Estado"><span class="tag ${active ? 'open' : 'closed'}">${estado}</span></td>
      <td data-label="Tipo"><select class="bank-edit-type" data-id="${b.id}" aria-label="Tipo">
        <option value="transferencia" ${type === 'transferencia' ? 'selected' : ''}>Transferencia</option>
        <option value="tarjeta" ${type === 'tarjeta' ? 'selected' : ''}>Tarjeta</option>
      </select></td>
      <td data-label="Comisión"><input class="bank-edit-commission a33-num" data-id="${b.id}" type="number" inputmode="decimal" step="0.01" min="0" value="${commission}" aria-label="Comisión porcentual"></td>
      <td data-label="Acción"><div class="actions bank-actions"><button class="btn-ok btn-mini btn-save-bank" data-id="${b.id}">Guardar</button><button class="${btnClass} btn-mini btn-toggle-bank" data-id="${b.id}">${btnTxt}</button></div></td>
    </tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function escapeHtml(str){
  return String(str||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

// Productos
function productEditNormKeyPOS(value){
  const raw = String(value || '').trim();
  if (!raw) return '';
  try{ if (typeof normKeyPOS === 'function') return normKeyPOS(raw); }catch(_){ }
  return raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'');
}

function productEditMoneyPOS(value, fallback=0){
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return round2(Math.max(0, n));
}

function productEditQtyPOS(value, fallback=0){
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round((n + Number.EPSILON) * 10000) / 10000);
}

function productEditDisplayMoneyPOS(value){
  const n = Number(value);
  return 'C$ ' + fmt(Number.isFinite(n) ? n : 0);
}

function productEditDisplayMlPOS(value){
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const fixed = Math.round((n + Number.EPSILON) * 100) / 100;
  return (String(fixed).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1')) + ' ml';
}

function productEditGetCapacityPOS(product){
  try{ return productEditQtyPOS(reempaqueCapacityMlFromProductPOS(product), 0); }catch(_){ return 0; }
}

function productEditGetUnitCostPOS(product){
  try{ return productEditMoneyPOS(getProductStoredUnitCostPOS(product), 0); }catch(_){
    const p = (product && typeof product === 'object') ? product : {};
    return productEditMoneyPOS(p.unitCost ?? p.costoUnitario ?? p.costPerUnit ?? 0, 0);
  }
}

function productEditSetMsgPOS(msg, kind=''){
  const el = document.getElementById('product-edit-msg');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'muted product-edit-msg' + (kind ? (' ' + kind) : '');
}

function productEditHasMatchingProductRefPOS(ref, product){
  if (!ref || !product) return false;
  const pid = String(product.id ?? '').trim();
  const pname = productEditNormKeyPOS(product.name || product.nombre || '');
  if (typeof ref === 'object'){
    const rid = String(ref.id ?? ref.productId ?? ref.productoId ?? ref.codigo ?? ref.code ?? '').trim();
    if (pid && rid && rid === pid) return true;
    const rn = productEditNormKeyPOS(ref.name || ref.nombre || ref.productName || ref.label || '');
    return !!(pname && rn && rn === pname);
  }
  const raw = String(ref || '').trim();
  if (pid && raw === pid) return true;
  const rn = productEditNormKeyPOS(raw);
  return !!(pname && rn && rn === pname);
}

function productEditReempaqueRecordTouchesPOS(record, product){
  if (!record || !product) return false;
  const pid = String(product.id ?? '').trim();
  const pname = productEditNormKeyPOS(product.name || product.nombre || '');
  const fields = [
    record.sourceProductId, record.productoOrigenId, record.productIdOrigen, record.origenId,
    record.targetProductId, record.productoDestinoId, record.productIdDestino, record.destinoId
  ];
  if (pid && fields.some(v => String(v ?? '').trim() === pid)) return true;
  const names = [
    record.sourceProductName, record.productoOrigenNombre, record.productoOrigen,
    record.targetProductName, record.productoDestinoNombre, record.productoDestino
  ];
  if (pname && names.some(v => productEditNormKeyPOS(v) === pname)) return true;
  if (productEditHasMatchingProductRefPOS(record.sourceProduct, product)) return true;
  if (productEditHasMatchingProductRefPOS(record.targetProduct, product)) return true;
  const destinos = Array.isArray(record.destinos) ? record.destinos : [];
  return destinos.some(d => {
    if (!d) return false;
    const dIds = [d.targetProductId, d.productoDestinoId, d.productId, d.id];
    if (pid && dIds.some(v => String(v ?? '').trim() === pid)) return true;
    const dNames = [d.targetProductName, d.productoDestinoNombre, d.productoDestino, d.name, d.nombre];
    if (pname && dNames.some(v => productEditNormKeyPOS(v) === pname)) return true;
    return productEditHasMatchingProductRefPOS(d.targetProduct, product) || productEditHasMatchingProductRefPOS(d.productoDestino, product);
  });
}

async function productEditHasMovementsPOS(product){
  if (!product) return false;
  const pid = catalogProductStableIdPOS(product);
  const internalId = catalogProductInternalIdPOS(product);
  try{
    const sales = await getAll('sales');
    if ((sales || []).some(s => saleMatchesCatalogProductPOS(s, product))) return true;
  }catch(_){ }
  try{
    const inv = await getAll('inventory');
    if ((inv || []).some(i => i && ((internalId && Number(i.productId) === internalId) || (pid && String(i.productId ?? '').trim() === pid)))) return true;
  }catch(_){ }
  try{
    const reempaques = await getAll(REEMPAQUE_STORE_POS);
    if ((reempaques || []).some(r => productEditReempaqueRecordTouchesPOS(r, product))) return true;
  }catch(_){ }
  return false;
}

function closeProductEditModalPOS(){
  const modal = document.getElementById('product-edit-modal');
  if (!modal) return;
  modal.style.display = 'none';
  try{ delete modal.dataset.productId; }catch(_){ }
  productEditSetMsgPOS('');
}

async function openProductEditModalPOS(productId){
  void productId;
  toast('Los Productos se administran en Catálogos → Productos');
  const modal = document.getElementById('product-edit-modal');
  if (modal) modal.style.display = 'none';
  return { ok:false, blocked:true, reason:'catalogos_productos_fuente_unica' };
}

async function saveProductEditModalPOS(){
  productEditSetMsgPOS('Los Productos se administran únicamente en Gestión Operativa → Catálogos → Productos.', 'warn');
  toast('Edición bloqueada: usa Catálogos → Productos');
  return { ok:false, blocked:true, reason:'catalogos_productos_fuente_unica' };
}

function setupProductEditModalPOS(){
  const modal = document.getElementById('product-edit-modal');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  const block = () => {
    productEditSetMsgPOS('Los Productos se administran únicamente en Gestión Operativa → Catálogos → Productos.', 'warn');
    toast('Edición bloqueada: usa Catálogos → Productos');
  };
  const closeBtn = document.getElementById('product-edit-close');
  const cancelBtn = document.getElementById('product-edit-cancel');
  const saveBtn = document.getElementById('product-edit-save');
  if (closeBtn) closeBtn.addEventListener('click', closeProductEditModalPOS);
  if (cancelBtn) cancelBtn.addEventListener('click', closeProductEditModalPOS);
  if (saveBtn){ saveBtn.disabled = true; saveBtn.addEventListener('click', block); }
  modal.addEventListener('click', (e)=>{ if (e.target === modal) closeProductEditModalPOS(); });
  modal.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') closeProductEditModalPOS();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter'){ e.preventDefault(); block(); }
  });
}

async function renderProductos(){
  // Guardia para HTML antiguo en caché: la vista legacy queda estrictamente informativa.
  const wrap = document.getElementById('productos-list');
  if (!wrap) return;
  const list = await getAll('products').catch(()=>[]);
  wrap.innerHTML = '';
  const notice = document.createElement('div');
  notice.className = list.length ? 'info' : 'warn';
  notice.textContent = list.length
    ? 'Productos en modo lectura. Administra altas, cambios y borrados en Gestión Operativa → Catálogos → Productos.'
    : 'No hay productos. Créelos primero en Gestión Operativa → Catálogos → Productos.';
  wrap.appendChild(notice);
  for (const p of (Array.isArray(list) ? list : [])){
    if (!p) continue;
    const row = document.createElement('div');
    row.className = 'card product-card-a33';
    const name = String(p.name || p.nombre || 'Producto sin nombre').trim() || 'Producto sin nombre';
    const status = p.active === false ? 'Inactivo' : 'Activo';
    row.innerHTML = `<div class="product-main-a33"><div class="product-title">${escapeHtml(name)}</div><small class="muted">${escapeHtml(status)} · Solo lectura desde POS</small></div>`;
    wrap.appendChild(row);
  }
}

// Productos internos/virtuales del POS que NO deben aparecer en selector ni inventario.
// Etapa Vasos desde Reempaque: "Vaso" ya es producto vendible normal; no se oculta.
async function getHiddenProductIdsPOS(){
  return new Set();
}

// Catálogos → Productos es la única fuente del selector POS.
// Solo se elimina un duplicado cuando repite exactamente el mismo productId; nunca por nombre o familia.
function posCanonicalProductsForSale(products){
  const byProductId = new Map();
  for (const product of (Array.isArray(products) ? products : [])){
    if (!productSellableInPOS(product)) continue;
    const productId = catalogProductStableIdPOS(product);
    if (!productId || byProductId.has(productId)) continue;
    byProductId.set(productId, product);
  }
  return Array.from(byProductId.values());
}

function posDuplicateNameCounts(products){
  const counts = new Map();
  (Array.isArray(products) ? products : []).forEach((product) => {
    const key = productEditNormKeyPOS(product && (product.name || product.nombre || ''));
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function posProductDisplayLabel(product, duplicateNames){
  const name = String((product && (product.name || product.nombre)) || 'Producto').trim() || 'Producto';
  const key = productEditNormKeyPOS(name);
  if (!duplicateNames || (duplicateNames.get(key) || 0) < 2) return name;
  const productId = catalogProductStableIdPOS(product);
  return `${name} · ${productId.slice(-6)}`;
}

// Chips de productos (activos + POS marcado desde Catálogos)
async function renderProductChips(){
  const chips = $('#product-chips'); if (!chips) return;
  chips.innerHTML='';

  const hiddenIds = await getHiddenProductIdsPOS();
  let list = posCanonicalProductsForSale((await getAll('products')).filter(p=>p && !hiddenIds.has(p.id)));
  const duplicateNames = posDuplicateNameCounts(list);

  // Orden con prioridad de Arcano 33
  const priority = ['pulso','media','djeba','litro','galon','galón','galon 3750','galón 3750','galon 3800','galón 3800'];
  list.sort((a,b)=>{
    const ia = priority.findIndex(x=>normName(a.name).includes(x));
    const ib = priority.findIndex(x=>normName(b.name).includes(x));
    const pa = ia===-1?999:ia; const pb = ib===-1?999:ib;
    if (pa!==pb) return pa-pb;
    return a.name.localeCompare(b.name, 'es');
  });

  const current = await getMeta('currentEventId');
  const evs = await getAll('events');
  const cur = evs.find(e=>e.id===current);
  const enabled = (typeof window.__A33_SELL_ENABLED === 'boolean') ? window.__A33_SELL_ENABLED : !!(current && cur && !cur.closedAt);

  const sel = $('#sale-product');
  const selected = parseSelectedSellItemValue(sel ? sel.value : '');

  // Productos
  for (const p of list){
    const c = document.createElement('button');
    c.className = 'chip';
    c.dataset.kind = 'product';
    c.dataset.productId = catalogProductStableIdPOS(p);
    c.dataset.internalId = String(catalogProductInternalIdPOS(p) || '');
    if (!enabled) c.classList.add('disabled');
    c.textContent = posProductDisplayLabel(p, duplicateNames);
    if (selected && selected.kind==='product' && catalogProductStableIdPOS(p) === selected.productId) c.classList.add('active');

    c.onclick = async()=>{
      if (!isSellEnabledNowPOS()) return;
      const prev = parseSelectedSellItemValue(sel.value);
      const stableId = catalogProductStableIdPOS(p);
      sel.value = `product:${encodeURIComponent(stableId)}`;
      const same = prev && prev.kind==='product' && prev.productId === stableId;
      if (same) { $('#sale-qty').value = Math.max(1, parseFloat($('#sale-qty').value||'1')) + 1; }
      else { $('#sale-qty').value = 1; }
      $('#sale-price').value = p.price;
      updateChipsActiveFromSelectionPOS();
      await refreshSaleStockLabel();
      recomputeTotal();
    };

    chips.appendChild(c);
  }

  // Extras (por evento)
  try{
    const ev = await getActiveEventPOS();
    const extras = ev ? sanitizeExtrasPOS(ev.extras).filter(x=>x && x.active!==false) : [];
    if (extras.length){
      // separador visual simple
      const sep = document.createElement('div');
      sep.className = 'chips-sep';
      sep.textContent = 'Extras';
      chips.appendChild(sep);

      extras.sort((a,b)=> a.name.localeCompare(b.name, 'es'));

      for (const x of extras){
        const c = document.createElement('button');
        c.className = 'chip extra';
        c.dataset.kind = 'extra';
        c.dataset.extraId = x.id;
        if (!enabled) c.classList.add('disabled');
        if (x.stock <= 0) c.classList.add('out');
        c.textContent = x.name;
        if (selected && selected.kind==='extra' && Number(selected.id) === Number(x.id)) c.classList.add('active');

        c.onclick = async()=>{
          if (!isSellEnabledNowPOS()) return;
          const prev = parseSelectedSellItemValue(sel.value);
          sel.value = `extra:${x.id}`;
          const same = prev && prev.kind==='extra' && prev.id === x.id;
          if (same) { $('#sale-qty').value = Math.max(1, parseFloat($('#sale-qty').value||'1')) + 1; }
          else { $('#sale-qty').value = 1; }
          $('#sale-price').value = x.unitPrice;
          updateChipsActiveFromSelectionPOS();
          await refreshSaleStockLabel();
          recomputeTotal();
        };

        chips.appendChild(c);
      }
    }
  }catch(e){
    // no-op
  }

  if (list.length===0){
    const warn = document.createElement('div');
    warn.className = 'warn';
    warn.textContent = 'No hay productos activos con POS marcado. Revisa Gestión Operativa → Catálogos → Productos.';
    chips.appendChild(warn);
  }
}

// Delegación de eventos para Productos
document.addEventListener('change', async (e)=>{
  if (e.target.classList.contains('p-name') || e.target.classList.contains('p-price') || e.target.classList.contains('p-manage') || e.target.classList.contains('p-active')){
    e.preventDefault();
    await renderProductos();
    toast('Cambios bloqueados: usa Catálogos → Productos');
  }
});
document.addEventListener('click', async (e)=>{
  const editBtn = e.target.closest('.btn-edit-product');
  if (editBtn){
    e.preventDefault();
    toast('Edición bloqueada: usa Catálogos → Productos');
    return;
  }

  const delBtn = e.target.closest('.btn-del');
  if (delBtn){
    e.preventDefault();
    toast('Borrado bloqueado: usa Catálogos → Productos');
    return;
  }
});

// Delegación de eventos para Bancos
document.addEventListener('click', async (e)=>{
  const saveBtn = e.target.closest('.btn-save-bank');
  const tBtn = e.target.closest('.btn-toggle-bank');
  if (!saveBtn && !tBtn) return;

  const id = parseInt((saveBtn || tBtn).dataset.id || '0', 10);
  if (!id) return;

  const banks = await getAllBanksSafe();
  const b = banks.find(x => Number(x.id) === id);
  if (!b) return;

  if (saveBtn){
    const row = saveBtn.closest('tr');
    const name = String(row?.querySelector('.bank-edit-name')?.value || '').trim();
    const type = normalizeBankTypePOS(row?.querySelector('.bank-edit-type')?.value || 'transferencia');
    const commissionPct = type === 'tarjeta' ? normalizeBankCommissionPOS(row?.querySelector('.bank-edit-commission')?.value || 0) : 0;
    if (!name){ alert('Nombre del banco'); return; }

    const dup = banks.find(x => Number(x.id) !== id && normBankName(x?.name) === normBankName(name) && getBankTypePOS(x) === type);
    if (dup){ alert('Ya existe un banco con ese nombre y tipo.'); return; }

    b.name = name;
    b.type = type;
    b.commissionPct = commissionPct;
    b.updatedAt = new Date().toISOString();
    await put('banks', b);
    await renderBancos();
    await refreshSaleBankSelect();
    toast('Banco guardado');
    return;
  }

  const currentlyActive = (b.isActive !== false);
  b.isActive = !currentlyActive;
  b.type = getBankTypePOS(b);
  b.commissionPct = getBankTypePOS(b) === 'tarjeta' ? getBankCommissionPctPOS(b) : 0;
  b.updatedAt = new Date().toISOString();
  await put('banks', b);
  await renderBancos();
  await refreshSaleBankSelect();
  toast('Banco actualizado');
});

// Tabs
function bindTabbarOncePOS(){
  const bar = document.querySelector('.tabbar');
  if (!bar) return;
  if (bar.dataset.bound === '1') return;
  bar.dataset.bound = '1';

  // Evitar doble-disparo (pointerup/touchend -> click) y doble setTab por mismo destino.
  // iPad moderno reporta PointerEvent, pero a veces el primer toque no llega como pointerup;
  // por eso siempre dejamos click como fallback y deduplicamos.
  let lastRealTapTs = 0;  // actualizado por pointerup/touchend
  let lastRealTapDest = '';
  const CLICK_DEDUPE_MS = 700;
  const NAV_DEDUPE_MS   = 650;
  const navLockUntil = Object.create(null); // dest -> ts límite
  let navSeq = 0; // monotónico: último request aceptado

  // iPad: durante scroll/inercia o con teclado abierto, el primer toque puede
  // solo frenar scroll o cerrar teclado y NO disparar click/pointerup.
  let lastScrollTs = 0;
  const SCROLL_RECENT_MS = 260;
  const microtask = (fn)=>{
    try{ if (typeof queueMicrotask === 'function') return queueMicrotask(fn); }catch(_){ }
    Promise.resolve().then(fn);
  };
  const isEditable = (el)=>{
    try{
      if (!el) return false;
      if (el.isContentEditable) return true;
      const t = String(el.tagName||'').toUpperCase();
      return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
    }catch(_){ return false; }
  };
  // Scroll listener global (evita múltiples binds si tabbar se re-renderiza)
  try{
    const root = document && document.documentElement;
    if (root && root.dataset && root.dataset.a33TabbarScrollBound !== '1'){
      root.dataset.a33TabbarScrollBound = '1';
      try{ document.addEventListener('scroll', ()=>{ lastScrollTs = Date.now(); }, { capture:true, passive:true }); }
      catch(_){ try{ document.addEventListener('scroll', ()=>{ lastScrollTs = Date.now(); }, true); }catch(__){} }
    }
  }catch(_){ }

  const acceptNav = (dest, nowTs)=>{
    try{
      const until = navLockUntil[dest] || 0;
      if (until && nowTs < until) return 0;
      navLockUntil[dest] = nowTs + NAV_DEDUPE_MS;
      navSeq = (navSeq + 1);
      if (navSeq > 2147483647) navSeq = 1; // evita wrap raro
      return navSeq;
    }catch(_){
      navSeq = (navSeq + 1);
      if (navSeq > 2147483647) navSeq = 1;
      return navSeq;
    }
  };

  const onTap = async (e)=>{
    // Solo botones con data-tab dentro de la barra
    const btn = e && e.target ? e.target.closest('button[data-tab]') : null;
    if (!btn || !bar.contains(btn)) return;

    // Ignorar clicks no primarios
    if (e && e.type === 'click' && typeof e.button === 'number' && e.button !== 0) return;

    // Pointer: ignorar no-primario / botones no principales (mouse)
    if (e && e.type === 'pointerup'){
      try{ if (typeof e.isPrimary === 'boolean' && !e.isPrimary) return; }catch(_){ }
      try{
        if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;
      }catch(_){ }
    }

    const dest = String(btn.dataset.tab || '').trim();
    if (!dest) return;

    const nowTs = Date.now();

    // Dedup: ignorar click inmediato después de pointerup/touchend *del mismo destino*.
    // (Si el pointerup se perdió en un tap distinto, el click debe poder entrar.)
    if (e && (e.type === 'pointerup' || e.type === 'touchend')){ lastRealTapTs = nowTs; lastRealTapDest = dest; }
    if (e && e.type === 'click' && lastRealTapTs && (nowTs - lastRealTapTs) < CLICK_DEDUPE_MS && lastRealTapDest === dest) return;

    // Fallback seguro: si no existe el tab destino, no-op limpio
    const target = document.getElementById('tab-' + dest);
    if (!target) return;

    // Guardia anti duplicación por (destino + ventana de tiempo) + evita carreras async:
    // sellamos el request ANTES de awaits, y descartamos requests viejos si llega uno nuevo.
    const mySeq = acceptNav(dest, nowTs);
    if (!mySeq) return;

    try{ if (e && e.preventDefault) e.preventDefault(); }catch(_){ }
    try{
      try{ await flushChecklistTextQueuePOS({ reason:'tabnav' }); }catch(_e){}
      if (mySeq !== navSeq) return; // request viejo: ya hubo otro tap
      setTab(dest);
    }catch(err){ console.error('TABNAV error', err); }
  };

  const onDown = (e)=>{
    // Solo botones con data-tab dentro de la barra
    const btn = e && e.target ? e.target.closest('button[data-tab]') : null;
    if (!btn || !bar.contains(btn)) return;

    // Pointer: solo touch/pen (evita efectos raros en desktop)
    try{
      if (e && e.type === 'pointerdown' && e.pointerType && e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    }catch(_){ }

    const dest = String(btn.dataset.tab || '').trim();
    if (!dest) return;

    const nowTs = Date.now();
    const ae = document.activeElement;
    const hadFocus = isEditable(ae);
    const scrolledRecently = lastScrollTs && (nowTs - lastScrollTs) < SCROLL_RECENT_MS;
    if (!hadFocus && !scrolledRecently) return;

    // Blur best-effort (cierra teclado)
    if (hadFocus){
      try{ ae && ae.blur && ae.blur(); }catch(_){ }
      try{ if (document.activeElement && isEditable(document.activeElement)) document.activeElement.blur(); }catch(_){ }
    }

    // Navegar en el mismo gesto (o microtask) usando el MISMO dedupe global
    microtask(()=>{
      try{
        onTap({
          target: btn,
          type: 'pointerdown',
          preventDefault: ()=>{ try{ e && e.preventDefault && e.preventDefault(); }catch(_){ } }
        });
      }catch(_){ }
    });
  };

  // Pointer Events cuando existan; fallback a touch/click
  const hasPointer = (typeof window !== 'undefined' && 'PointerEvent' in window);
  if (hasPointer) {
    bar.addEventListener('pointerdown', onDown, { passive:false });
    // Fallback extra: touchstart también (dedupe evita doble)
    bar.addEventListener('touchstart', onDown, { passive:false });

    bar.addEventListener('pointerup', onTap);
    // Fallback click incluso con PointerEvent (iPad/Safari/PWA)
    bar.addEventListener('click', onTap);
  } else {
    bar.addEventListener('touchstart', onDown, { passive:false });
    bar.addEventListener('touchend', onTap, { passive:false });
    bar.addEventListener('click', onTap);
  }
}


function setTab(name){
  // Canonical tab names (Etapa 12B): "venta" es la única verdad.
  // Compatibilidad: si llega "vender" por URL/hash/estado viejo, mapear a "venta".
  try{
    if (name === 'vender') name = 'venta';
  }catch(_){ }

  // Checklist: antes de salir, intentar persistir texto pendiente (best-effort)
  try{
    if (window.__A33_ACTIVE_TAB === 'checklist' && name !== 'checklist'){
      flushChecklistTextQueuePOS({ reason:'setTab' }).catch(()=>{});
    }
  }catch(_e){}

const tabs = $$('.tab');
  const target = document.getElementById('tab-'+name);
  if (!target) return;

  // Botón activo en tabbar
  $$('.tabbar button').forEach(b=>b.classList.remove('active'));
  const btn = document.querySelector(`.tabbar button[data-tab="${name}"]`);
  if (btn) btn.classList.add('active');

  // Tab actual visible (fallback robusto)
  let current = null;
  if (window.__A33_ACTIVE_TAB){
    const el = document.getElementById('tab-'+window.__A33_ACTIVE_TAB);
    if (el && el !== target && el.style.display !== 'none' && getComputedStyle(el).display !== 'none'){
      current = el;
    }
  }
  if (!current){
    current = tabs.find(el => el !== target && el.style.display !== 'none' && getComputedStyle(el).display !== 'none') || null;
  }

  // Mostrar target con micro animación (sin reestructurar layout)
  if (current && current !== target){
    target.style.display = 'block';
    target.classList.add('a33-tab-prep');
    void target.offsetHeight; // reflow
    target.classList.remove('a33-tab-prep');

    current.classList.add('a33-tab-out');
    setTimeout(()=>{
      current.style.display = 'none';
      current.classList.remove('a33-tab-out');
    }, 160);
  } else {
    // Primer render / estado inconsistente: asegura solo uno visible
    tabs.forEach(el=> el.style.display='none');
    target.style.display='block';
    target.classList.add('a33-tab-prep');
    requestAnimationFrame(()=> target.classList.remove('a33-tab-prep'));
  }

  window.__A33_ACTIVE_TAB = name;

  // Render específico por pestaña (misma lógica de antes)
  if (name==='resumen') renderSummary();
  if (name==='extras') { renderExtrasUI().catch(err=>console.error(err)); renderBancos().catch(err=>console.error(err)); }
  if (name==='eventos') renderEventos();
  if (name==='inventario') renderInventario();
  if (name==='efectivo') renderEfectivoTab().catch(err=>console.error(err));
  if (name==='calculadora') onOpenPosCalculatorTab().catch(err=>console.error(err));
  if (name==='checklist') renderChecklistTab().catch(err=>console.error(err));
  if (name==='venta') {
    syncExchangeRateInputs().catch(err=>console.error(err));
    try{ setupSaleCashTenderUIOnce(); refreshSaleCashTenderUiPOS({ forceFx:true }); }catch(_){ }
  }
}

// --- Deep-link mínimo (Centro de Mando -> POS)
function getTabFromUrlPOS(){
  try{
    const allowed = new Set(['venta','inventario','eventos','efectivo','resumen','extras','calculadora','checklist']);
    // Querystring
    const qs = new URLSearchParams(window.location.search || '');
    const qTab = (qs.get('tab') || '').trim();
    if (qTab){
      const qt = (qTab === 'vender') ? 'venta' : (qTab === 'productos' ? 'extras' : qTab);
      if (allowed.has(qt)) return qt;
    }

    // Hash: #tab=venta o #venta (compat: #tab=vender / #vender)
    const h = (window.location.hash || '').replace(/^#/, '').trim();
    if (!h) return null;
    // Alias: CdM → Recordatorios (abre Checklist)
    if (h === 'checklist-reminders' || h === 'checklist-reminders-card') return 'checklist';
    if (h.startsWith('checklist-reminders')) return 'checklist';
    if (h.startsWith('tab=')){
      const ht = h.slice(4).trim();
      const htab = (ht === 'vender') ? 'venta' : (ht === 'productos' ? 'extras' : ht);
      if (allowed.has(htab)) return htab;
    }
    const hh = (h === 'vender') ? 'venta' : (h === 'productos' ? 'extras' : h);
    if (allowed.has(hh)) return hh;
  }catch(_){ }
  return null;
}

function getDeepScrollTargetFromUrlPOS(){
  try{
    const h = (window.location.hash || '').replace(/^#/, '').trim();
    if (!h) return null;
    // CdM: #checklist-reminders -> scroll a la card real
    if (h === 'checklist-reminders' || h === 'checklist-reminders-card' || h.startsWith('checklist-reminders')){
      return 'checklist-reminders-card';
    }
  }catch(_){ }
  return null;
}

function scheduleScrollToIdPOS(id){
  const targetId = String(id || '').trim();
  if (!targetId) return;
  const tryScroll = (n)=>{
    const el = document.getElementById(targetId);
    if (el){
      try{ el.scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){ el.scrollIntoView(); }
      return;
    }
    if (n >= 12) return;
    setTimeout(()=> tryScroll(n+1), 120);
  };
  setTimeout(()=> tryScroll(0), 80);
}

// --- Checklist (POS)
const CHECKLIST_SECTIONS_POS = [
  { key: 'pre', listId: 'chk-pre', addId: 'chk-add-pre' },
  { key: 'evento', listId: 'chk-evento', addId: 'chk-add-evento' },
  { key: 'cierre', listId: 'chk-cierre', addId: 'chk-add-cierre' },
];

function makeChecklistItemIdPOS(){
  try{ return (crypto && crypto.randomUUID) ? crypto.randomUUID() : null; }catch(e){}
  return 'chk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}

// --- Checklist: persistencia robusta del texto (Etapa 1 iPad-safe)
function _getChecklistDraftStorePOS(){
  if (!window.__A33_CHECKLIST_DRAFT){
    window.__A33_CHECKLIST_DRAFT = {
      eventId: null,
      q: Object.create(null),          // key: section::id -> rawText
      lastQueued: Object.create(null), // evitar re-encolar el mismo valor
      lastSaved: Object.create(null),  // last persisted (para evitar writes)
      t: null,
      flushing: false,
    };
  }
  return window.__A33_CHECKLIST_DRAFT;
}

function _normalizeChecklistTextPOS(raw, prev){
  const v = (raw == null ? '' : String(raw)).trim();
  // Comportamiento elegido: si queda vacío, se restaura placeholder coherente con el modelo actual.
  if (!v) return (prev && String(prev).trim()) ? String(prev).trim() : 'Nuevo ítem';
  return v;
}

function queueChecklistTextSavePOS(sectionKey, id, rawText, opts){
  const o = (opts || {});
  if (!sectionKey || !id) return;
  const d = _getChecklistDraftStorePOS();
  const key = String(sectionKey) + '::' + String(id);
  const raw = (rawText == null ? '' : String(rawText));

  // Evitar escrituras excesivas: solo encolar si cambió vs último encolado
  if (d.lastQueued[key] === raw && !o.force) return;
  d.lastQueued[key] = raw;
  d.q[key] = raw;

  // Debounce razonable (iPad): guarda mientras escribe, y además se fuerza en blur/navegación
  if (d.t) clearTimeout(d.t);
  const wait = (typeof o.wait === 'number') ? o.wait : 280;
  d.t = setTimeout(()=>{ flushChecklistTextQueuePOS({ reason: 'debounce' }).catch(()=>{}); }, Math.max(120, wait));
}

async function flushChecklistTextQueuePOS(opts){
  const o = (opts || {});
  const d = _getChecklistDraftStorePOS();

  // Nada que hacer
  const keys = Object.keys(d.q);
  if (!keys.length) return;

  // Evitar flush concurrente
  if (d.flushing) return;
  d.flushing = true;

  try{
    if (d.t){ clearTimeout(d.t); d.t = null; }

    const evId = (d.eventId != null) ? parseInt(d.eventId, 10) : null;
    let eventId = (evId && Number.isFinite(evId)) ? evId : null;

    if (!eventId){
      try{
        const cur = await getMeta('currentEventId');
        const curId = (cur === null || cur === undefined || cur === '') ? null : parseInt(cur, 10);
        if (curId && Number.isFinite(curId)) eventId = curId;
      }catch(_e){}
    }

    if (!eventId){
      // Sin evento: limpiar cola para no envenenar futuras sesiones
      d.q = Object.create(null);
      return;
    }

    const ev = await getEventByIdPOS(eventId);
    if (!ev){
      d.q = Object.create(null);
      return;
    }

    // ensureChecklistDataPOS garantiza la plantilla base
    const dayKey = safeYMD(getSaleDayKeyPOS());
    const { template } = ensureChecklistDataPOS(ev, dayKey);

    let changed = false;

    for (const k of keys){
      const raw = d.q[k];
      const parts = String(k).split('::');
      const sectionKey = parts[0] || '';
      const id = parts.slice(1).join('::'); // por si acaso
      if (!sectionKey || !id) continue;

      const arr = Array.isArray(template[sectionKey]) ? template[sectionKey] : [];
      const it = arr.find(x=>String(x.id)===String(id));
      if (!it) continue;

      const next = _normalizeChecklistTextPOS(raw, it.text);
      const lastSavedKey = String(eventId) + '|' + k;

      // Evitar write si no cambió
      if (String(it.text || '') !== String(next)){
        it.text = next;
        template[sectionKey] = arr;
        changed = true;
      }

      d.lastSaved[lastSavedKey] = next;
    }

    // Limpiar cola antes del put para no repetir si ocurre render rápido
    d.q = Object.create(null);

    if (changed){
      ev.checklistTemplate = template;
      await put('events', ev);
    }
  }catch(err){
    console.error('Checklist flush error', err);
  }finally{
    d.flushing = false;
  }
}

function bindChecklistLifecycleFlushPOS(){
  if (window.__A33_CHECKLIST_LIFECYCLE_BOUND) return;
  window.__A33_CHECKLIST_LIFECYCLE_BOUND = true;

  // Si se oculta la app (iPad/PWA), intentar flush best-effort
  try{
    document.addEventListener('visibilitychange', ()=>{
      if (document.visibilityState === 'hidden'){
        flushChecklistTextQueuePOS({ reason:'visibility' }).catch(()=>{});
      }
    });
  }catch(_e){}

  try{
    window.addEventListener('pagehide', ()=>{
      flushChecklistTextQueuePOS({ reason:'pagehide' }).catch(()=>{});
    });
  }catch(_e){}
}


function makeReminderIdPOS(){
  try{ return (crypto && crypto.randomUUID) ? crypto.randomUUID() : null; }catch(e){}
  return 'rem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}

function normalizeChecklistTemplatePOS(t){
  const out = (t && typeof t === 'object') ? t : {};
  const normArr = (arr)=>{
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(x=>x && typeof x === 'object')
      .map(x=>({ id: String(x.id || makeChecklistItemIdPOS()), text: String(x.text || '').trim() }))
      .filter(x=>x.text.length>0 || x.id);
  };
  return {
    pre: normArr(out.pre),
    evento: normArr(out.evento),
    cierre: normArr(out.cierre),
  };
}

function ensureChecklistDataPOS(ev, dayKey){
  let changed = false;
  if (!ev || typeof ev !== 'object') return { changed:false, template:{pre:[],evento:[],cierre:[]}, state:{checkedIds:[], notes:''} };

  if (!ev.checklistTemplate || typeof ev.checklistTemplate !== 'object') {
    ev.checklistTemplate = { pre: [], evento: [], cierre: [] };
    changed = true;
  }
  const tpl = normalizeChecklistTemplatePOS(ev.checklistTemplate);
  // Persistir normalización si cambia estructura
  if (JSON.stringify(tpl) !== JSON.stringify(ev.checklistTemplate)) {
    ev.checklistTemplate = tpl;
    changed = true;
  }

  if (!ev.days || typeof ev.days !== 'object') {
    ev.days = {};
    changed = true;
  }
  if (!ev.days[dayKey] || typeof ev.days[dayKey] !== 'object') {
    ev.days[dayKey] = {};
    changed = true;
  }
  if (!ev.days[dayKey].checklistState || typeof ev.days[dayKey].checklistState !== 'object') {
    ev.days[dayKey].checklistState = { checkedIds: [], notes: '', reminders: [] };
    changed = true;
  }
  const st = ev.days[dayKey].checklistState;
  if (!Array.isArray(st.checkedIds)) { st.checkedIds = []; changed = true; }
  if (typeof st.notes !== 'string') { st.notes = String(st.notes || ''); changed = true; }

  // Recordatorios (por día)
  if (!Array.isArray(st.reminders)) { st.reminders = []; changed = true; }
  const normReminders = (arr)=>{
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const raw of arr){
      if (!raw || typeof raw !== 'object') continue;
      const id = String(raw.id || makeReminderIdPOS());
      const text = String(raw.text || '').trim();
      if (!text) continue;
      const done = !!raw.done;
      const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
      let updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
      let doneAt = (raw.doneAt === null || raw.doneAt === undefined) ? null : Number(raw.doneAt);
      if (!Number.isFinite(doneAt)) doneAt = null;

      // Fecha (obligatoria) — compat: si venía sin dueDateKey, lo asumimos como el día contenedor.
      // Regla: el día contenedor manda. Si el reminder vive en ev.days[dayKey], su dueDateKey debe ser dayKey.
      let dueDateKey = (typeof raw.dueDateKey === 'string') ? raw.dueDateKey.trim() : '';
      if (!dueDateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dueDateKey)) dueDateKey = String(dayKey);
      if (String(dueDateKey) !== String(dayKey)) dueDateKey = String(dayKey);

      let dueTime = (typeof raw.dueTime === 'string') ? raw.dueTime.trim() : null;
      if (!dueTime || !/^\d{2}:\d{2}$/.test(dueTime)) dueTime = null;
      let priority = (typeof raw.priority === 'string') ? raw.priority.trim() : null;
      if (!priority || !['high','med','low'].includes(priority)) priority = null;
      if (!done) {
        doneAt = null;
      } else if (done && doneAt === null) {
        doneAt = Date.now();
      }
      // Si venía sin updatedAt pero sí con doneAt (históricos), respetamos doneAt como última modificación.
      if (!Number.isFinite(raw.updatedAt) && Number.isFinite(doneAt) && doneAt > updatedAt) updatedAt = doneAt;
      out.push({ id, text, done, createdAt, updatedAt, doneAt, dueDateKey, dueTime, priority });
    }
    return out;
  };
  const rem2 = normReminders(st.reminders);
  if (JSON.stringify(rem2) !== JSON.stringify(st.reminders)) { st.reminders = rem2; changed = true; }

  // Limpieza: checkedIds solo válidos según template
  const allIds = new Set([
    ...tpl.pre.map(x=>x.id),
    ...tpl.evento.map(x=>x.id),
    ...tpl.cierre.map(x=>x.id),
  ]);
  const filtered = st.checkedIds.map(String).filter(id=>allIds.has(id));
  if (filtered.length !== st.checkedIds.length) {
    st.checkedIds = filtered;
    changed = true;
  }

  return { changed, template: tpl, state: st };
}

// --- Recordatorios: índice liviano (posRemindersIndex)
// Objetivo: permitir lectura rápida (p.ej. Centro de Mando) sin escanear eventos completos.
function buildReminderIndexIdPOS(eventId, dayKey, reminderId){
  return `${String(dayKey)}|${String(eventId)}|${String(reminderId)}`;
}

async function getRemindersIndexRowsForEventDayPOS(eventId, dayKey){
  try{
    if (!db) await openDB();
    if (!db || !db.objectStoreNames.contains('posRemindersIndex')) return [];
    const evId = Number(eventId);
    const dk = String(dayKey);

    return await new Promise((resolve)=>{
      try{
        const t = db.transaction(['posRemindersIndex'], 'readonly');
        const st = t.objectStore('posRemindersIndex');

        let idx = null;
        try{ idx = st.index('by_event_day'); }catch(e){ idx = null; }

        if (idx){
          let range = null;
          try{ range = IDBKeyRange.only([evId, dk]); }catch(e){ range = null; }
          const r = range ? idx.getAll(range) : idx.getAll();
          r.onsuccess = ()=>resolve(r.result || []);
          r.onerror = ()=>resolve([]);
          return;
        }

        const r = st.getAll();
        r.onsuccess = ()=>{
          const all = r.result || [];
          resolve(all.filter(x=>String(x.eventId)===String(evId) && String(x.dayKey)===dk));
        };
        r.onerror = ()=>resolve([]);
      }catch(e){
        resolve([]);
      }
    });
  }catch(e){
    return [];
  }
}

// FUNCIÓN CENTRAL (obligatoria)
// syncRemindersIndexForDay(ev, dayKey)
// - Upsert lo actual + delete lo que ya no existe (sin duplicados)
async function syncRemindersIndexForDay(ev, dayKey){
  try{
    if (!ev || !dayKey) return;
    if (!db) await openDB();
    if (!db || !db.objectStoreNames.contains('posRemindersIndex')) return;

    const eventId = Number(ev.id);
    const eventName = String(ev.name || '').trim();
    const dk = String(dayKey);

    // Leer reminders del día actual
    const { state } = ensureChecklistDataPOS(ev, dk);
    const reminders = Array.isArray(state.reminders) ? state.reminders : [];

    // Construir set de idxId esperado
    const expected = new Set();
    const rows = [];

    for (const r of reminders){
      if (!r || typeof r !== 'object') continue;
      const reminderId = String(r.id || '').trim();
      const text = String(r.text || '').trim();
      if (!reminderId || !text) continue;

      const idxId = buildReminderIndexIdPOS(eventId, dk, reminderId);
      expected.add(idxId);

      const createdAt = Number.isFinite(r.createdAt) ? r.createdAt : Date.now();
      const updatedAt = Number.isFinite(r.updatedAt) ? r.updatedAt : createdAt;

      rows.push({
        idxId,
        eventId,
        eventName,
        dayKey: dk,
        reminderId,
        text,
        done: !!r.done,
        dueTime: (typeof r.dueTime === 'string' && /^\d{2}:\d{2}$/.test(r.dueTime.trim())) ? r.dueTime.trim() : null,
        priority: (typeof r.priority === 'string' && ['high','med','low'].includes(r.priority.trim())) ? r.priority.trim() : null,
        createdAt,
        updatedAt
      });
    }

    // Leer del índice todas las filas de ese (eventId, dayKey)
    const existing = await getRemindersIndexRowsForEventDayPOS(eventId, dk);

    // Upsert + Delete (en una sola transacción)
    await new Promise((resolve)=>{
      try{
        const t = db.transaction(['posRemindersIndex'], 'readwrite');
        const st = t.objectStore('posRemindersIndex');

        // Upsert: por cada reminder actual → put en índice
        for (const row of rows){
          try{ st.put(row); }catch(_e){}
        }

        // Delete: eliminar del índice todo registro que exista pero ya no esté en el set esperado
        for (const old of (existing || [])){
          const oldId = old && old.idxId ? String(old.idxId) : '';
          if (!oldId) continue;
          if (!expected.has(oldId)){
            try{ st.delete(oldId); }catch(_e){}
          }
        }

        t.oncomplete = ()=>resolve();
        t.onerror = ()=>resolve();
        t.onabort = ()=>resolve();
      }catch(e){
        resolve();
      }
    });
  }catch(e){
    console.warn('syncRemindersIndexForDay: fallo (se ignora para no romper POS)', e);
  }
}

// Rebuild completo del índice (recomendado para consistencia)
// - Vacía posRemindersIndex y lo reconstruye recorriendo todos los eventos y días
// - Normaliza dueDateKey (compat) sin romper data vieja
async function rebuildRemindersIndexPOS(){
  try{
    if (!db) await openDB();
    if (!db || !db.objectStoreNames.contains('posRemindersIndex')) return false;

    // 1) Vaciar índice
    try{ await clearStore('posRemindersIndex'); }catch(_e){ /* no-op */ }

    // 2) Recorrer eventos
    let events = [];
    try{ events = await getAll('events'); }catch(_e){ events = []; }
    if (!Array.isArray(events) || !events.length) return true;

    let batch = [];
    const flush = async ()=>{
      if (!batch.length) return;
      await new Promise((resolve)=>{
        try{
          const t = db.transaction(['posRemindersIndex'], 'readwrite');
          const st = t.objectStore('posRemindersIndex');
          for (const row of batch){
            try{ st.put(row); }catch(_e){}
          }
          t.oncomplete = ()=>resolve();
          t.onerror = ()=>resolve();
          t.onabort = ()=>resolve();
        }catch(e){
          resolve();
        }
      });
      batch = [];
    };

    for (const ev of events){
      if (!ev || typeof ev !== 'object') continue;
      const eventId = Number(ev.id);
      if (!eventId) continue;
      const eventName = String(ev.name || '').trim();

      const dayObj = (ev.days && typeof ev.days === 'object') ? ev.days : {};
      const dayKeys = Object.keys(dayObj || {});
      if (!dayKeys.length) continue;

      let evTouched = false;
      for (const dk of dayKeys){
        if (typeof dk !== 'string' || !dk) continue;

        const { changed, state } = ensureChecklistDataPOS(ev, dk);
        if (changed) evTouched = true;

        const reminders = Array.isArray(state && state.reminders) ? state.reminders : [];
        for (const r of reminders){
          if (!r || typeof r !== 'object') continue;
          const reminderId = String(r.id || '').trim();
          const text = String(r.text || '').trim();
          if (!reminderId || !text) continue;

          const idxId = buildReminderIndexIdPOS(eventId, dk, reminderId);
          const createdAt = Number.isFinite(r.createdAt) ? r.createdAt : Date.now();
          const updatedAt = Number.isFinite(r.updatedAt) ? r.updatedAt : createdAt;

          batch.push({
            idxId,
            eventId,
            eventName,
            dayKey: String(dk),
            reminderId,
            text,
            done: !!r.done,
            dueTime: (typeof r.dueTime === 'string' && /^\d{2}:\d{2}$/.test(r.dueTime.trim())) ? r.dueTime.trim() : null,
            priority: (typeof r.priority === 'string' && ['high','med','low'].includes(r.priority.trim())) ? r.priority.trim() : null,
            createdAt,
            updatedAt
          });

          if (batch.length >= 400) await flush();
        }
      }

      // Persistir normalización de dueDateKey solo si tocamos algo.
      if (evTouched){
        try{ await put('events', ev); }catch(_e){}
      }
    }

    await flush();
    return true;
  }catch(e){
    console.warn('rebuildRemindersIndexPOS: fallo (se ignora para no romper POS)', e);
    return false;
  }
}

// Ejecutar rebuild una sola vez por instalación (y una sola vez por sesión)
async function maybeRebuildRemindersIndexPOS(){
  try{
    if (window.__A33_REM_INDEX_REBUILT) return;
    window.__A33_REM_INDEX_REBUILT = true;
    const KEY = 'a33_pos_remindersIndex_rebuild_dueDate_v1';
    const done = (localStorage.getItem(KEY) || '') === '1';
    if (done) return;
    const ok = await rebuildRemindersIndexPOS();
    if (ok) localStorage.setItem(KEY, '1');
  }catch(_e){ /* no-op */ }
}

function renderChecklistSectionPOS(sectionKey, listEl, items, checkedSet){
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.padding = '8px 4px';
    empty.textContent = 'Sin ítems. Usa “+ Agregar ítem”.';
    listEl.appendChild(empty);
    return;
  }

  items.forEach((it, idx)=>{
    const row = document.createElement('div');
    row.className = 'chk-row';
    row.dataset.section = sectionKey;
    row.dataset.id = it.id;
    row.dataset.idx = String(idx);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'chk-box';
    cb.checked = checkedSet.has(it.id);
    cb.dataset.section = sectionKey;
    cb.dataset.id = it.id;

    const txt = document.createElement('input');
    txt.type = 'text';
    txt.className = 'chk-text';
    txt.value = it.text || '';
    txt.placeholder = 'Ítem…';
    txt.dataset.section = sectionKey;
    txt.dataset.id = it.id;

    const actions = document.createElement('div');
    actions.className = 'chk-actions';

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn-mini chk-mini chk-up';
    up.textContent = '↑';
    up.disabled = idx === 0;
    up.dataset.section = sectionKey;
    up.dataset.id = it.id;

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'btn-mini chk-mini chk-down';
    down.textContent = '↓';
    down.disabled = idx === items.length - 1;
    down.dataset.section = sectionKey;
    down.dataset.id = it.id;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-mini chk-mini chk-del';
    del.textContent = '✕';
    del.dataset.section = sectionKey;
    del.dataset.id = it.id;

    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(del);

    row.appendChild(cb);
    row.appendChild(txt);
    row.appendChild(actions);

    listEl.appendChild(row);
  });
}

function labelReminderPriorityPOS(p){
  if (p === 'high') return 'Alta';
  if (p === 'med') return 'Media';
  if (p === 'low') return 'Baja';
  return '';
}

function classReminderPriorityPOS(p){
  if (p === 'high') return 'rem-pri-high';
  if (p === 'med') return 'rem-pri-med';
  if (p === 'low') return 'rem-pri-low';
  return '';
}

function buildReminderRowPOS(rem){
  const row = document.createElement('div');
  row.className = 'rem-item';
  row.dataset.id = String(rem.id);

  const dayKey = (rem && (rem.__dayKey || rem.dayKey || rem.dueDateKey)) ? String(rem.__dayKey || rem.dayKey || rem.dueDateKey) : '';
  if (dayKey) row.dataset.dayKey = dayKey;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'rem-toggle';
  cb.checked = !!rem.done;
  cb.dataset.id = String(rem.id);
  if (dayKey) cb.dataset.dayKey = dayKey;

  const main = document.createElement('div');
  main.className = 'rem-main';

  const text = document.createElement('div');
  text.className = 'rem-textline';
  text.textContent = String(rem.text || '');

  const meta = document.createElement('div');
  meta.className = 'rem-meta';

  if (rem.dueTime){
    const chip = document.createElement('span');
    chip.className = 'rem-chip rem-chip-time';
    chip.textContent = '⏰ ' + String(rem.dueTime);
    meta.appendChild(chip);
  }
  if (rem.priority){
    const chip = document.createElement('span');
    chip.className = 'rem-chip ' + classReminderPriorityPOS(rem.priority);
    chip.textContent = labelReminderPriorityPOS(rem.priority);
    meta.appendChild(chip);
  }

  main.appendChild(text);
  if (meta.childElementCount) main.appendChild(meta);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn-mini btn-pill-mini rem-del';
  del.textContent = '✕';
  del.title = 'Eliminar';
  del.dataset.id = String(rem.id);
  if (dayKey) del.dataset.dayKey = dayKey;

  row.appendChild(cb);
  row.appendChild(main);
  row.appendChild(del);
  return row;
}

function renderChecklistRemindersPOS(ev, baseDayKey){
  const countEl = document.getElementById('checklist-reminder-count');
  const listEl = document.getElementById('checklist-reminder-list');
  const doneToggle = document.getElementById('checklist-reminder-done-toggle');
  const doneWrap = document.getElementById('checklist-reminder-done-wrap');
  const doneList = document.getElementById('checklist-reminder-done-list');
  const clearDoneBtn = document.getElementById('checklist-reminder-clear-done');

  if (!listEl || !ev) return;

  const dayKey = safeYMD(baseDayKey);
  const dayKeys = rangeDayKeysPOS(dayKey, 7);

  const priRank = (p)=> (p==='high'?0:(p==='med'?1:(p==='low'?2:3)));

  // Recolectar por día
  const byDay = {};
  const doneByDay = {};
  let totalPending = 0;
  let totalDone = 0;

  for (const dk of dayKeys){
    const { state } = ensureChecklistDataPOS(ev, dk);
    const arr = Array.isArray(state.reminders) ? state.reminders : [];

    const pend = arr.filter(r=>!r.done).map(r=>({ ...r, __dayKey: dk }));
    const done = arr.filter(r=>!!r.done).map(r=>({ ...r, __dayKey: dk }));

    pend.sort((a,b)=>{
      const ta = a.dueTime || '99:99';
      const tb = b.dueTime || '99:99';
      if (ta !== tb) return ta.localeCompare(tb);
      const pa = priRank(a.priority), pb = priRank(b.priority);
      if (pa !== pb) return pa - pb;
      return (b.updatedAt||0) - (a.updatedAt||0);
    });

    done.sort((a,b)=>{
      // completados: por doneAt desc (y fallback updatedAt)
      const da = (a.doneAt||0) || (a.updatedAt||0);
      const db = (b.doneAt||0) || (b.updatedAt||0);
      return db - da;
    });

    byDay[dk] = pend;
    doneByDay[dk] = done;
    totalPending += pend.length;
    totalDone += done.length;
  }

  if (countEl) countEl.textContent = String(totalPending);

  // Helpers UI
  const mkTitle = (txt)=>{
    const el = document.createElement('div');
    el.className = 'rem-section-title';
    el.textContent = txt;
    return el;
  };
  const mkSubDate = (ymd)=>{
    const el = document.createElement('div');
    el.className = 'rem-date-title';
    el.textContent = formatDayKeyShortESPOS(ymd);
    return el;
  };
  const mkGap = ()=>{
    const el = document.createElement('div');
    el.className = 'rem-gap';
    return el;
  };

  // Pendientes (Hoy + Próximos)
  listEl.innerHTML = '';

  const todayPend = byDay[dayKey] || [];
  const upcomingKeys = dayKeys.slice(1);
  const hasUpcoming = upcomingKeys.some(k => (byDay[k]||[]).length);

  if (!totalPending){
    const empty = document.createElement('div');
    empty.className = 'rem-empty';
    empty.textContent = 'Sin recordatorios pendientes.';
    listEl.appendChild(empty);
  } else {
    if (todayPend.length){
      listEl.appendChild(mkTitle('Hoy'));
      for (const r of todayPend) listEl.appendChild(buildReminderRowPOS(r));
    }

    if (todayPend.length && hasUpcoming){
      listEl.appendChild(mkGap());
    }

    if (hasUpcoming){
      listEl.appendChild(mkTitle('Próximos'));
      for (const dk of upcomingKeys){
        const arr = byDay[dk] || [];
        if (!arr.length) continue;
        listEl.appendChild(mkSubDate(dk));
        for (const r of arr) listEl.appendChild(buildReminderRowPOS(r));
      }
    }

    // Caso raro: hay pendientes solo hoy o solo próximos; ya renderizado.
  }

  // Completados (rango)
  const open = !!window.__A33_REM_DONE_OPEN;
  if (doneWrap) doneWrap.style.display = (open && totalDone) ? 'block' : 'none';
  if (doneToggle){
    doneToggle.disabled = (totalDone === 0);
    doneToggle.setAttribute('aria-expanded', (open && totalDone) ? 'true' : 'false');
    doneToggle.textContent = `Completados (${totalDone}) ${(open && totalDone) ? '▾' : '▸'}`;
  }
  if (clearDoneBtn) clearDoneBtn.disabled = (totalDone === 0);

  if (doneList){
    doneList.innerHTML = '';
    if (!totalDone){
      const empty = document.createElement('div');
      empty.className = 'rem-empty';
      empty.textContent = 'Aún no hay completados.';
      doneList.appendChild(empty);
    } else {
      for (const dk of dayKeys){
        const arr = doneByDay[dk] || [];
        if (!arr.length) continue;
        // Para completados, preferimos encabezado por fecha siempre (no Hoy/Próximos)
        doneList.appendChild(mkSubDate(dk));
        for (const r of arr) doneList.appendChild(buildReminderRowPOS(r));
      }
    }
  }
}

async function getChecklistContextPOS(){
  const cur = await getMeta('currentEventId');
  const curId = (cur === null || cur === undefined || cur === '') ? null : parseInt(cur,10);
  if (!curId) return null;
  const dayKey = safeYMD(getSaleDayKeyPOS());
  const ev = await getEventByIdPOS(curId);
  if (!ev) return null;
  const { state } = ensureChecklistDataPOS(ev, dayKey);
  return { curId, dayKey, ev, state };
}

async function saveChecklistStatePOS(ctx){
  if (!ctx || !ctx.ev || !ctx.ev.days || !ctx.dayKey) return;
  if (!ctx.ev.days[ctx.dayKey] || typeof ctx.ev.days[ctx.dayKey] !== 'object') ctx.ev.days[ctx.dayKey] = {};
  ctx.ev.days[ctx.dayKey].checklistState = ctx.state;
  await put('events', ctx.ev);
}

async function renderChecklistTab(){
  // Bind listeners (idempotente)
  try{ bindChecklistEventsOncePOS(); }catch(_e){}

  // Hardening: asegurar índice posRemindersIndex coherente (se ejecuta 1 vez)
  try{ await maybeRebuildRemindersIndexPOS(); }catch(_e){}

  const empty = document.getElementById('checklist-empty');
  const grid = document.getElementById('checklist-grid');
  const sel = document.getElementById('checklist-event');

  const fail = (msg)=>{
    try{
      if (grid) grid.style.display = 'none';
      if (empty){
        empty.style.display = 'block';
        empty.textContent = msg || 'Checklist no disponible.';
      }
    }catch(_e){}
  };

  try{
    // Hardening: si el selector quedó vacío por orden de carga, repoblar localmente (sin tocar refreshEventUI global)
    try{
      if (sel && sel.options && sel.options.length <= 1){
        const evs = await getAll('events');
        sel.innerHTML = '<option value="">— Selecciona evento —</option>';
        for (const evx of (evs || [])){
          const o = document.createElement('option');
          o.value = evx.id;
          o.textContent = (evx.name || 'Evento') + (evx.closedAt ? ' (cerrado)' : '');
          sel.appendChild(o);
        }
      }
    }catch(_e){}

    const current = await getMeta('currentEventId');
    const currentId = (current === null || current === undefined || current === '') ? null : parseInt(current, 10);

    try{
      window.__A33_CHECKLIST_EVENT_ID = currentId;
      const d = _getChecklistDraftStorePOS();
      d.eventId = currentId;
    }catch(_e){}

    if (sel) sel.value = currentId ? String(currentId) : '';

    if (!currentId) {
      fail('Selecciona un evento para ver el Checklist.');
      return;
    }

    const ev = await getEventByIdPOS(currentId);
    if (!ev) {
      fail('Evento no encontrado. Revisa la pestaña Eventos.');
      return;
    }

    const dayKey = safeYMD(getSaleDayKeyPOS());

    // Default de fecha para nuevos recordatorios: sigue el día del Checklist (sin pisar si el usuario la cambió manualmente)
    try{
      const dateEl = document.getElementById('checklist-reminder-date');
      if (dateEl){
        const last = (dateEl.dataset.lastDayKey || '').toString();
        const curVal = (dateEl.value || '').toString().trim();
        if (!curVal || curVal === last) dateEl.value = dayKey;
        dateEl.dataset.lastDayKey = dayKey;
      }
    }catch(_e){}

    const { changed, template, state } = ensureChecklistDataPOS(ev, dayKey);
    if (changed) {
      try{ await put('events', ev); }catch(e){ console.error('Checklist: no se pudo persistir inicialización', e); }
      // Si acabamos de normalizar/crear recordatorios del día (datos antiguos), mantenemos el índice coherente.
      try{ await syncRemindersIndexForDay(ev, dayKey); }catch(e){}
    }

    if (empty) empty.style.display = 'none';
    if (grid) grid.style.display = 'grid';

    const checkedSet = new Set((state.checkedIds || []).map(String));

    // Render columnas
    for (const sec of CHECKLIST_SECTIONS_POS){
      const listEl = document.getElementById(sec.listId);
      renderChecklistSectionPOS(sec.key, listEl, template[sec.key] || [], checkedSet);
    }

    const notes = document.getElementById('checklist-notes');
    if (notes) notes.value = state.notes || '';

    // Recordatorios (por día)
    try{ renderChecklistRemindersPOS(ev, dayKey); }catch(e){ console.warn('Checklist: recordatorios', e); }
  }catch(err){
    console.error('Checklist render error', err);
    fail('Checklist: no se pudo cargar. Recarga el POS o vuelve a intentar.');
    try{ showToast('Checklist: error al cargar (ver consola).'); }catch(_e){}
  }
}

function _getChecklistBindStorePOS(){
  if (!window.__A33_CHECKLIST_BIND_STORE_POS){
    window.__A33_CHECKLIST_BIND_STORE_POS = { h: Object.create(null), notesTimer: null };
  }
  return window.__A33_CHECKLIST_BIND_STORE_POS;
}

function bindChecklistEventsOncePOS(){
  const tab = document.getElementById('tab-checklist');
  if (!tab) return;

  // Lifecycle flush (idempotente)
  try{ bindChecklistLifecycleFlushPOS(); }catch(_e){}

  const s = _getChecklistBindStorePOS();

  if (!s.h.onInput){
    s.h.onInput = (e)=>{
      try{
        const t = e && e.target;
        const txt = t && t.closest ? t.closest('.chk-text') : null;
        if (txt && tab.contains(txt)){
          const id = txt.dataset.id;
          const sectionKey = txt.dataset.section;
          if (id && sectionKey) queueChecklistTextSavePOS(sectionKey, id, txt.value, { wait: 260 });
          return;
        }

        // Notas del día (debounced) — dentro del tab para evitar bind extra
        if (t && t.id === 'checklist-notes'){
          try{ clearTimeout(s.notesTimer); }catch(_e){}
          s.notesTimer = setTimeout(async ()=>{
            try{
              const cur = await getMeta('currentEventId');
              const curId = cur ? parseInt(cur,10) : null;
              if (!curId) return;
              const dayKey = safeYMD(getSaleDayKeyPOS());
              const ev = await getEventByIdPOS(curId);
              if (!ev) return;
              const { state } = ensureChecklistDataPOS(ev, dayKey);
              state.notes = t.value || '';
              ev.days[dayKey].checklistState = state;
              await put('events', ev);
            }catch(err){ console.error('Checklist notes save error', err); }
          }, 350);
        }
      }catch(err){ console.error('Checklist input handler error', err); }
    };

    s.h.onBlur = (e)=>{
      try{
        const t = e && e.target;
        const txt = t && t.closest ? t.closest('.chk-text') : null;
        if (!txt || !tab.contains(txt)) return;
        const id = txt.dataset.id;
        const sectionKey = txt.dataset.section;
        if (!id || !sectionKey) return;
        // Normaliza vacío -> placeholder coherente
        if (!String(txt.value || '').trim()) txt.value = 'Nuevo ítem';
        queueChecklistTextSavePOS(sectionKey, id, txt.value, { force:true, wait: 0 });
        flushChecklistTextQueuePOS({ reason:'blur', force:true }).catch(()=>{});
      }catch(err){ console.error('Checklist blur handler error', err); }
    };

    s.h.onKeydown = (e)=>{
      try{
        if (!e || e.key !== 'Enter') return;
        const t = e.target;
        if (!t || !t.id) return;
        if (t.id === 'checklist-reminder-text' || t.id === 'checklist-reminder-date' || t.id === 'checklist-reminder-due' || t.id === 'checklist-reminder-priority'){
          e.preventDefault();
          const btn = document.getElementById('checklist-reminder-add');
          try{ btn && btn.click(); }catch(_e){}
        }
      }catch(err){ console.error('Checklist keydown handler error', err); }
    };

    s.h.onClick = (e)=>{
      (async ()=>{
        const t = e && e.target;
        if (!t || !t.closest) return;

        const go = t.closest('#checklist-go-events');
        if (go){
          setTab('eventos');
          return;
        }

        // + Agregar ítem (delegado)
        const addBtn = t.closest('.chk-add');
        if (addBtn){
          const sectionKey = String(addBtn.dataset.section || '').trim();
          if (!sectionKey) return;
          const current = await getMeta('currentEventId');
          const currentId = current ? parseInt(current,10) : null;
          if (!currentId){
            try{ showToast('Selecciona un evento primero.'); }catch(_e){}
            return;
          }
          const dayKey = safeYMD(getSaleDayKeyPOS());
          const ev = await getEventByIdPOS(currentId);
          if (!ev) return;
          const { template } = ensureChecklistDataPOS(ev, dayKey);
          const id = makeChecklistItemIdPOS();
          template[sectionKey] = Array.isArray(template[sectionKey]) ? template[sectionKey] : [];
          template[sectionKey].push({ id, text: 'Nuevo ítem' });
          ev.checklistTemplate = template;
          await put('events', ev);
          await renderChecklistTab();
          const qid = String(id).replace(/"/g, '\"');
          const input = document.querySelector(`#tab-checklist .chk-text[data-id="${qid}"]`);
          if (input){
            input.focus();
            try{ input.select(); }catch(_e){}
          }
          return;
        }

        const remAdd = t.closest('#checklist-reminder-add');
        const remDoneToggle = t.closest('#checklist-reminder-done-toggle');
        const remClearDone = t.closest('#checklist-reminder-clear-done');
        const remDel = t.closest('.rem-del');

        if (remDoneToggle){
          if (remDoneToggle.disabled) return;
          window.__A33_REM_DONE_OPEN = !window.__A33_REM_DONE_OPEN;
          await renderChecklistTab();
          return;
        }

        if (remAdd){
          const ctx = await getChecklistContextPOS();
          if (!ctx){
            try{ showToast('Selecciona un evento primero.'); }catch(_e){}
            return;
          }

          const tEl = document.getElementById('checklist-reminder-text');
          const dateEl = document.getElementById('checklist-reminder-date');
          const dueEl = document.getElementById('checklist-reminder-due');
          const priEl = document.getElementById('checklist-reminder-priority');

          const text = (tEl ? (tEl.value || '') : '').trim();
          if (!text){
            try{ showToast('Escribe el recordatorio.'); }catch(_e){}
            try{ tEl && tEl.focus(); }catch(_e){}
            return;
          }

          // Fecha obligatoria (YYYY-MM-DD). Si el input no existe (edge), caemos al día actual.
          const dueDateRaw = dateEl ? String(dateEl.value || '').trim() : '';
          const dueDateKey = (dueDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw)) ? dueDateRaw : null;
          if (!dueDateKey){
            try{ showToast('Selecciona una fecha (obligatoria).'); }catch(_e){}
            try{ dateEl && dateEl.focus(); }catch(_e){}
            return;
          }

          const dueTimeRaw = dueEl ? (dueEl.value || '').trim() : '';
          const dueTime = (dueTimeRaw && /^\d{2}:\d{2}$/.test(dueTimeRaw)) ? dueTimeRaw : null;
          const priRaw = priEl ? (priEl.value || '').trim() : '';
          const priority = (priRaw && ['high','med','low'].includes(priRaw)) ? priRaw : null;

          // Guardar en el día destino (dueDateKey). No cambiamos sale-date automáticamente.
          const { state: destState } = ensureChecklistDataPOS(ctx.ev, dueDateKey);
          const ctxDest = { ...ctx, dayKey: dueDateKey, state: destState };

          ctxDest.state.reminders = Array.isArray(ctxDest.state.reminders) ? ctxDest.state.reminders : [];
          const now = Date.now();
          ctxDest.state.reminders.unshift({
            id: makeReminderIdPOS(),
            text,
            done: false,
            createdAt: now,
            updatedAt: now,
            doneAt: null,
            dueDateKey,
            dueTime,
            priority
          });

          await saveChecklistStatePOS(ctxDest);
          try{ await syncRemindersIndexForDay(ctx.ev, dueDateKey); }catch(e){}
          if (tEl) tEl.value = '';
          if (dueEl) dueEl.value = '';
          if (priEl) priEl.value = '';
          await renderChecklistTab();
          try{
            if (String(dueDateKey) !== String(ctx.dayKey)) showToast(`Guardado para ${dueDateKey}`);
            else showToast('Recordatorio agregado.');
          }catch(_e){}
          try{ tEl && tEl.focus(); }catch(_e){}
          return;
        }

        if (remClearDone){
          const ctx = await getChecklistContextPOS();
          if (!ctx) return;
          const ok = confirm('¿Limpiar todos los recordatorios completados de los próximos 7 días?');
          if (!ok) return;

          const base = safeYMD(ctx.dayKey);
          const dayKeys = rangeDayKeysPOS(base, 7);
          const changedDays = [];

          for (const dk of dayKeys){
            const { state } = ensureChecklistDataPOS(ctx.ev, dk);
            const arr = Array.isArray(state.reminders) ? state.reminders : [];
            const next = arr.filter(r=>!r.done);
            if (next.length !== arr.length){
              state.reminders = next;
              ctx.ev.days[dk].checklistState = state;
              changedDays.push(dk);
            }
          }

          if (changedDays.length){
            await put('events', ctx.ev);
            for (const dk of changedDays){
              try{ await syncRemindersIndexForDay(ctx.ev, dk); }catch(e){}
            }
          }

          window.__A33_REM_DONE_OPEN = false;
          await renderChecklistTab();
          try{ showToast('Completados eliminados (próximos 7 días).'); }catch(_e){}
          return;
        }

        if (remDel){
          const id = remDel.dataset.id;
          if (!id) return;
          const ctx = await getChecklistContextPOS();
          if (!ctx) return;

          const dkRaw = (remDel.dataset.dayKey || remDel.dataset.daykey || '').toString().trim();
          const dayKey = (dkRaw && /^\d{4}-\d{2}-\d{2}$/.test(dkRaw)) ? dkRaw : ctx.dayKey;

          const { state } = ensureChecklistDataPOS(ctx.ev, dayKey);
          state.reminders = (Array.isArray(state.reminders) ? state.reminders : []).filter(r=>String(r.id)!==String(id));
          ctx.ev.days[dayKey].checklistState = state;

          await put('events', ctx.ev);
          try{ await syncRemindersIndexForDay(ctx.ev, dayKey); }catch(e){}
          await renderChecklistTab();
          try{ showToast('Recordatorio eliminado.'); }catch(_e){}
          return;
        }

        const up = t.closest('.chk-up');
        const down = t.closest('.chk-down');
        const delBtn = t.closest('.chk-del');
        const reset = t.closest('#checklist-reset-day');

        if (reset){
          const cur = await getMeta('currentEventId');
          const curId = cur ? parseInt(cur,10) : null;
          if (!curId) return;
          const ok = confirm('¿Reiniciar checks del día? (solo desmarca)');
          if (!ok) return;
          const dayKey = safeYMD(getSaleDayKeyPOS());
          const ev = await getEventByIdPOS(curId);
          if (!ev) return;
          const { state } = ensureChecklistDataPOS(ev, dayKey);
          state.checkedIds = [];
          ev.days[dayKey].checklistState = state;
          await put('events', ev);
          await renderChecklistTab();
          try{ showToast('Checks reiniciados.'); }catch(e){}
          return;
        }

        if (!(up || down || delBtn)) return;
        const btn = up || down || delBtn;
        const sectionKey = btn.dataset.section;
        const id = btn.dataset.id;
        const cur = await getMeta('currentEventId');
        const curId = cur ? parseInt(cur,10) : null;
        if (!curId || !sectionKey || !id) return;

        const dayKey = safeYMD(getSaleDayKeyPOS());
        const ev = await getEventByIdPOS(curId);
        if (!ev) return;
        const { template, state } = ensureChecklistDataPOS(ev, dayKey);

        const arr = Array.isArray(template[sectionKey]) ? template[sectionKey] : [];
        const idx = arr.findIndex(x=>String(x.id)===String(id));
        if (idx < 0) return;

        if (delBtn){
          const ok = confirm('¿Eliminar este ítem?');
          if (!ok) return;
          arr.splice(idx,1);
          template[sectionKey] = arr;
          // limpiar del estado del día
          state.checkedIds = (state.checkedIds||[]).map(String).filter(cid=>cid!==String(id));
          ev.checklistTemplate = template;
          ev.days[dayKey].checklistState = state;
          await put('events', ev);
          await renderChecklistTab();
          try{ showToast('Ítem eliminado.'); }catch(e){}
          return;
        }

        const dir = up ? -1 : 1;
        const j = idx + dir;
        if (j < 0 || j >= arr.length) return;
        [arr[idx], arr[j]] = [arr[j], arr[idx]];
        template[sectionKey] = arr;
        ev.checklistTemplate = template;
        await put('events', ev);
        await renderChecklistTab();
      })().catch((err)=> console.error('Checklist click handler error', err));
    };

    s.h.onChange = (e)=>{
      (async ()=>{
        const t = e && e.target;
        if (!t || !t.closest) return;

        // Selector de evento del Checklist
        if (t.id === 'checklist-event'){
          try{ await flushChecklistTextQueuePOS({ reason:'event-switch', force:true }); }catch(_e){}
          await resetOperationalStateOnEventSwitchPOS();
          const val = (t.value || '').trim();
          if (!val) {
            await setMeta('currentEventId', null);
          } else {
            await setMeta('currentEventId', parseInt(val,10));
          }
          await refreshEventUI();
          try{ await refreshSaleStockLabel(); }catch(e){}
          try{ await renderDay(); }catch(e){}
          try{ await renderChecklistTab(); }catch(e){}
          try{ showToast('Evento actualizado en todo el POS.'); }catch(e){}
          return;
        }

        const cb = t.closest('.chk-box');
        const txt = t.closest('.chk-text');
        const remCb = t.closest('.rem-toggle');
        if (!(cb || txt || remCb)) return;

        const cur = await getMeta('currentEventId');
        const curId = cur ? parseInt(cur,10) : null;
        if (!curId) return;
        const baseDayKey = safeYMD(getSaleDayKeyPOS());
        const ev = await getEventByIdPOS(curId);
        if (!ev) return;

        if (remCb){
          const id = remCb.dataset.id;
          if (!id) return;
          const dkRaw = (remCb.dataset.dayKey || remCb.dataset.daykey || '').toString().trim();
          const dayKey = (dkRaw && /^\d{4}-\d{2}-\d{2}$/.test(dkRaw)) ? dkRaw : baseDayKey;
          const { state } = ensureChecklistDataPOS(ev, dayKey);
          const arr = Array.isArray(state.reminders) ? state.reminders : [];
          const it = arr.find(r=>String(r.id)===String(id));
          if (!it) return;
          it.done = !!remCb.checked;
          it.doneAt = it.done ? Date.now() : null;
          it.updatedAt = Date.now();
          state.reminders = arr;
          ev.days[dayKey].checklistState = state;
          await put('events', ev);
          try{ await syncRemindersIndexForDay(ev, dayKey); }catch(e){}
          await renderChecklistTab();
          return;
        }

        const dayKey = baseDayKey;
        const { state } = ensureChecklistDataPOS(ev, dayKey);

        if (cb){
          const id = cb.dataset.id;
          if (!id) return;
          const set = new Set((state.checkedIds||[]).map(String));
          if (cb.checked) set.add(String(id));
          else set.delete(String(id));
          state.checkedIds = Array.from(set);
          ev.days[dayKey].checklistState = state;
          await put('events', ev);
          return;
        }

        if (txt){
          const id = txt.dataset.id;
          const sectionKey = txt.dataset.section;
          if (!id || !sectionKey) return;

          // Normaliza vacío -> placeholder coherente
          if (!String(txt.value || '').trim()) txt.value = 'Nuevo ítem';

          // Encolar + flush inmediato como respaldo del input/debounce (iPad-safe)
          queueChecklistTextSavePOS(sectionKey, id, txt.value, { force:true, wait: 0 });
          await flushChecklistTextQueuePOS({ reason:'change', force:true });
          return;
        }
      })().catch((err)=> console.error('Checklist change handler error', err));
    };
  }

  // Bind idempotente (misma referencia => no duplica)
  tab.addEventListener('input', s.h.onInput);
  tab.addEventListener('blur', s.h.onBlur, true);
  tab.addEventListener('click', s.h.onClick);
  tab.addEventListener('change', s.h.onChange);
  tab.addEventListener('keydown', s.h.onKeydown);

  window.__A33_CHECKLIST_BOUND = true;
}

// Event UI
function refreshGroupSelectFromEvents(evs) {
  const sel = $('#event-group-select');
  if (!sel) return;

  // Asegurar catálogo persistente (para conservar grupos aunque se borren eventos)
  let catalog = ensureGroupCatalogFromEventsPOS(evs);
  // Si no hay eventos y el catálogo está vacío, intentar recuperar desde localStorage
  if ((!catalog || !catalog.length) && (!evs || !evs.length)) {
    try {
      const rec = recoverGroupCatalogFromLocalStoragePOS();
      catalog = (rec && rec.catalog) ? rec.catalog : readGroupCatalogPOS();
    } catch (_e) {
      try { catalog = readGroupCatalogPOS(); } catch(_){ catalog = []; }
    }
  }
  const hidden = new Set(getHiddenGroups());
  const groups = (catalog || []).filter(g => g && !hidden.has(g));

  sel.innerHTML = '';

  const optEmpty = document.createElement('option');
  optEmpty.value = '';
  optEmpty.textContent = '— Selecciona grupo —';
  sel.appendChild(optEmpty);

  for (const g of groups) {
    const o = document.createElement('option');
    o.value = g;
    o.textContent = g;
    sel.appendChild(o);
  }

  const optNew = document.createElement('option');
  optNew.value = '__new__';
  optNew.textContent = '+ Crear nuevo grupo';
  sel.appendChild(optNew);

  const last = getLastGroupName();
  if (last && groups.includes(last)) {
    sel.value = last;
  } else {
    sel.value = '';
  }

  const newInput = $('#event-group-new');
  if (newInput) {
    if (sel.value === '__new__') {
      newInput.style.display = 'inline-block';
    } else {
      newInput.style.display = 'none';
      newInput.value = '';
    }
  }
}

async function refreshEventUI(){
  const evs = await getAll('events');
  refreshGroupSelectFromEvents(evs);
  const sel = $('#sale-event');
  const current = await getMeta('currentEventId');

  sel.innerHTML = '<option value="">— Selecciona evento —</option>';
  for (const ev of evs) {
    const opt = document.createElement('option'); opt.value = ev.id; 
    opt.textContent = ev.name + (ev.closedAt ? ' (cerrado)' : '');
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
  else sel.value = '';

  const status = $('#event-status');
  const cur = evs.find(e=> current && e.id == current);

  // Mantener por defecto el último Evento Maestro (grupo) trabajado.
  // Si el evento activo tiene grupo, lo tomamos como "último" automáticamente.
  try{
    const gCur = (cur && cur.groupName) ? String(cur.groupName).trim() : '';
    if (gCur){
      const hidden = new Set(getHiddenGroups());
      if (!hidden.has(gCur)){
        setLastGroupName(gCur);
        const gs = $('#event-group-select');
        if (gs && Array.from(gs.options).some(o=>o.value===gCur)){
          gs.value = gCur;
        }
      }
    }
  }catch(e){
    console.warn('No se pudo sincronizar grupo desde el evento activo', e);
  }
  if (cur && cur.closedAt) {
    status.style.display='block';
    status.textContent = `Evento cerrado el ${new Date(cur.closedAt).toLocaleString()}. Puedes reabrirlo o crear/activar otro.`;
  } else { status.style.display='none'; }
  $('#btn-reopen-event').style.display = (cur && cur.closedAt) ? 'inline-block' : 'none';
  const invSel = $('#inv-event');
  if (invSel){
    invSel.innerHTML='';
    for (const ev of evs){
      const o = document.createElement('option'); o.value = ev.id; o.textContent = ev.name + (ev.closedAt?' (cerrado)':''); invSel.appendChild(o);
    }
    if (current) invSel.value = current;
    else if (evs.length) invSel.value = evs[0].id;
  }

  // Selector de evento en Checklist (usa el mismo evento activo global del POS)
  const chkSel = document.getElementById('checklist-event');
  if (chkSel){
    chkSel.innerHTML = '<option value="">— Selecciona evento —</option>';
    for (const ev of evs){
      const o = document.createElement('option');
      o.value = ev.id;
      o.textContent = ev.name + (ev.closedAt ? ' (cerrado)' : '');
      chkSel.appendChild(o);
    }
    if (current) chkSel.value = current;
    else chkSel.value = '';
  }

  // Selector de evento en Resumen (GLOBAL vs Evento): estado separado
  const sumSel = document.getElementById('summary-close-event');
  if (sumSel){
    let saved = SUMMARY_EVENT_GLOBAL_POS;
    try{ saved = await getSelectedSummaryEventIdPOS(); }catch(_){ saved = SUMMARY_EVENT_GLOBAL_POS; }

    const actives = (evs || []).filter(e=>e && !e.closedAt);
    const closeds = (evs || []).filter(e=>e && e.closedAt);

    sumSel.innerHTML = '';

    const og = document.createElement('option');
    og.value = SUMMARY_EVENT_GLOBAL_POS;
    og.textContent = 'GLOBAL — Todos los eventos';
    sumSel.appendChild(og);

    for (const ev of actives){
      const o = document.createElement('option');
      o.value = ev.id;
      o.textContent = ev.name || 'Evento';
      sumSel.appendChild(o);
    }
    for (const ev of closeds){
      const o = document.createElement('option');
      o.value = ev.id;
      o.textContent = (ev.name || 'Evento') + ' (cerrado)';
      sumSel.appendChild(o);
    }

    const hasSaved = Array.from(sumSel.options).some(o=> String(o.value) === String(saved));
    if (hasSaved){
      sumSel.value = String(saved);
    } else {
      sumSel.value = SUMMARY_EVENT_GLOBAL_POS;
      try{ await setSelectedSummaryEventIdPOS(SUMMARY_EVENT_GLOBAL_POS); }catch(_){ }
    }

    sumSel.disabled = false;
  }

  await updateSellEnabled();
  try{ await syncExchangeRateInputs(); }catch(e){ console.warn('No se pudo sincronizar T/C en Vender', e); }
  try{ await refreshProductSelect({ keepSelection:true }); }catch(e){ try{ await renderProductChips(); }catch(_){ } }
  try{ await renderExtrasUI(); }catch(e){}
}

async function refreshProductSelect(opts){
  opts = opts || {};
  const keepSelection = (opts.keepSelection !== false);

  const hiddenIds = await getHiddenProductIdsPOS();
  const all = await getAll('products');
  const list = posCanonicalProductsForSale(all.filter(p => p && !hiddenIds.has(p.id)));
  const duplicateNames = posDuplicateNameCounts(list);

  const sel = $('#sale-product');
  if (!sel) return;

  const prevVal = keepSelection ? String(sel.value || '').trim() : '';
  sel.innerHTML = '';

  // Productos reales del Catálogo
  for (const p of list) {
    const productId = catalogProductStableIdPOS(p);
    const opt = document.createElement('option');
    opt.value = `product:${encodeURIComponent(productId)}`;
    opt.dataset.productId = productId;
    opt.dataset.internalId = String(catalogProductInternalIdPOS(p) || '');
    opt.textContent = `${posProductDisplayLabel(p, duplicateNames)} (C${fmt(p.price)})`;
    sel.appendChild(opt);
  }

  if (!list.length){
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No hay productos activos habilitados para POS';
    empty.disabled = true;
    empty.selected = true;
    sel.appendChild(empty);
  }

  // Extras del evento activo
  try{
    const ev = await getActiveEventPOS();
    const extras = ev ? sanitizeExtrasPOS(ev.extras).filter(x=>x && x.active!==false) : [];
    if (ev && extras.length){
      const og = document.createElement('optgroup');
      og.label = 'Extras';
      for (const x of extras){
        const opt = document.createElement('option');
        opt.value = `extra:${x.id}`;
        const flags = [];
        if (x.stock <= 0) flags.push('SIN STOCK');
        else if (x.stock <= x.lowStockAlert) flags.push('BAJO');
        opt.textContent = `${x.name} (C${fmt(x.unitPrice)})${flags.length ? ' ['+flags.join(', ')+']' : ''}`;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
  }catch(e){
    console.warn('No se pudieron cargar Extras para el selector', e);
  }

  // Reseleccionar si aplica
  if (keepSelection && prevVal && Array.from(sel.options).some(o => o.value === prevVal)){
    sel.value = prevVal;
  } else {
    const first = sel.querySelector('option');
    if (first) sel.value = first.value;
  }

  await setSalePriceFromSelectionPOS();
  await renderProductChips();
  await refreshSaleStockLabel();
  recomputeTotal();
}

async function refreshSaleStockLabel(){
  const curId = await getMeta('currentEventId');
  const selVal = String($('#sale-product')?.value || '').trim();
  const item = parseSelectedSellItemValue(selVal);

  if (!curId || !item){
    $('#sale-stock').textContent='—';
    return;
  }

  if (item.kind === 'extra'){
    const ev = await getActiveEventPOS();
    const extras = ev ? sanitizeExtrasPOS(ev.extras) : [];
    const x = extras.find(z => Number(z.id) === Number(item.id));
    $('#sale-stock').textContent = x ? String(x.stock) : '—';
    return;
  }

  const products = await getAll('products');
  const p = findCatalogProductByStableIdPOS(products, item.productId);
  if (!p || !productManageStockForSalePOS(p, true)) { $('#sale-stock').textContent='—'; return; }
  const st = await computeStock(parseInt(curId,10), p);
  $('#sale-stock').textContent = st;
}

// --- Extras por evento (solo POS / por evento activo) ---
let editingExtraIdPOS = null;

function parseSelectedSellItemValue(val){
  const v = String(val || '').trim();
  if (!v) return null;
  if (v.startsWith('extra:')){
    const id = parseInt(v.slice(6), 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return { kind:'extra', id };
  }
  if (v.startsWith('product:')){
    let productId = '';
    try{ productId = decodeURIComponent(v.slice(8)); }catch(_){ productId = v.slice(8); }
    productId = String(productId || '').trim();
    return productId ? { kind:'product', productId } : null;
  }
  // Compatibilidad visual con HTML antiguo en caché: un valor numérico solo puede resolver un producto existente.
  const legacyId = parseInt(v, 10);
  if (Number.isFinite(legacyId) && legacyId > 0) return { kind:'product-legacy', internalId:legacyId };
  return null;
}

function sanitizeExtrasPOS(raw){
  const arr = Array.isArray(raw) ? raw : [];
  const clean = [];
  for (const x of arr){
    if (!x) continue;
    const id = parseInt(x.id, 10);
    if (!id) continue;
    const name = String(x.name || '').trim();
    if (!name) continue;
    const stock = Number(x.stock || 0);
    const unitCost = Number(x.unitCost || 0);
    const unitPrice = Number(x.unitPrice || 0);
    const lowStockAlert = safeInt(x.lowStockAlert, 5);
    clean.push({
      id,
      name,
      stock: Number.isFinite(stock) ? stock : 0,
      unitCost: Number.isFinite(unitCost) ? unitCost : 0,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      lowStockAlert: (lowStockAlert>0?lowStockAlert:5),
      active: (x.active === false) ? false : true,
      catalogExtraId: x.catalogExtraId || null,
      source: x.source || null,
      createdAt: x.createdAt || null,
      updatedAt: x.updatedAt || null
    });
  }
  return clean;
}

function ensureEventExtraSeqPOS(ev){
  if (!ev) return;
  const extras = sanitizeExtrasPOS(ev.extras);
  let maxId = 0;
  for (const x of extras) maxId = Math.max(maxId, Number(x.id) || 0);
  const cur = safeInt(ev.extraSeq, 0);
  ev.extraSeq = Math.max(cur, maxId);
  ev.extras = extras;
}

async function getActiveEventPOS(){
  const curId = await getMeta('currentEventId');
  if (!curId) return null;
  const evs = await getAll('events');
  const ev = evs.find(e => e.id === curId) || null;
  if (!ev || ev.closedAt) return null;
  ensureEventExtraSeqPOS(ev);
  return ev;
}

async function setSalePriceFromSelectionPOS(){
  const sel = $('#sale-product');
  if (!sel) return;
  const item = parseSelectedSellItemValue(sel.value);
  if (!item) return;
  if (item.kind === 'product' || item.kind === 'product-legacy'){
    const products = await getAll('products');
    const p = item.kind === 'product'
      ? findCatalogProductByStableIdPOS(products, item.productId)
      : products.find(x => Number(x && x.id) === Number(item.internalId));
    if (p && productSellableInPOS(p)) $('#sale-price').value = p.price;
    return;
  }
  const ev = await getActiveEventPOS();
  if (!ev) return;
  const extras = sanitizeExtrasPOS(ev.extras);
  const x = extras.find(z => Number(z.id) === Number(item.id));
  if (x) $('#sale-price').value = x.unitPrice;
}

function updateChipsActiveFromSelectionPOS(){
  const sel = $('#sale-product');
  const item = parseSelectedSellItemValue(sel ? sel.value : '');
  document.querySelectorAll('#product-chips .chip').forEach(btn => {
    const kind = (btn.dataset.kind || 'product');
    let isActive = false;
    if (item){
      if (item.kind === 'product' && kind === 'product'){
        isActive = (String(btn.dataset.productId || '') === item.productId);
      }
      if (item.kind === 'extra' && kind === 'extra'){
        isActive = (parseInt(btn.dataset.extraId || '0', 10) === item.id);
      }
    }
    btn.classList.toggle('active', isActive);
  });
}

function resetExtraFormPOS(){
  editingExtraIdPOS = null;
  const name = document.getElementById('extra-name');
  const stock = document.getElementById('extra-stock');
  const cost = document.getElementById('extra-cost');
  const price = document.getElementById('extra-price');
  const low = document.getElementById('extra-low');
  if (name) name.value = '';
  if (stock) stock.value = '';
  if (cost) cost.value = '';
  if (price) price.value = '';
  if (low) low.value = '';
  const btnCancel = document.getElementById('btn-cancel-extra');
  if (btnCancel) btnCancel.style.display = 'none';
}

async function getAllMasterExtrasSafePOS(){
  try{ return await getAll('extras'); }catch(e){ return []; }
}

function normalizeMasterExtraPOS(x){
  if (!x || typeof x !== 'object') return null;
  const name = String(x.name || x.nombre || '').trim();
  if (!name) return null;
  const price = Number(x.basePrice ?? x.price ?? x.unitPrice ?? x.precioBase ?? 0);
  const unitCost = Number(x.unitCost ?? x.costoUnitario ?? x.costPerUnit ?? 0);
  const lowStockAlert = safeInt(x.lowStockAlert ?? x.stockLowAlert ?? 5, 5);
  return {
    id: Number(x.id || 0),
    name,
    unitPrice: Number.isFinite(price) && price >= 0 ? round2(price) : 0,
    unitCost: Number.isFinite(unitCost) && unitCost >= 0 ? round2(unitCost) : 0,
    lowStockAlert: lowStockAlert > 0 ? lowStockAlert : 5,
    active: x.active === false ? false : true
  };
}

async function renderMasterExtrasImportPOS(ev){
  const sel = document.getElementById('extra-master-select');
  const note = document.getElementById('extra-master-note');
  const stock = document.getElementById('extra-master-stock');
  const btn = document.getElementById('btn-import-master-extra');
  if (!sel) return;
  const enabled = !!ev;
  if (stock) stock.disabled = !enabled;
  if (btn) btn.disabled = !enabled;
  sel.disabled = !enabled;
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = enabled ? '— Selecciona extra maestro —' : 'Activa un evento primero';
  sel.appendChild(opt0);
  if (!enabled){
    if (note) note.textContent = 'Activa un evento para importar extras maestros.';
    return;
  }
  const masters = (await getAllMasterExtrasSafePOS()).map(normalizeMasterExtraPOS).filter(x => x && x.active !== false);
  masters.sort((a,b)=> a.name.localeCompare(b.name, 'es-NI', { sensitivity:'base' }));
  for (const x of masters){
    const opt = document.createElement('option');
    opt.value = String(x.id);
    opt.textContent = `${x.name} (C${fmt(x.unitPrice)})`;
    sel.appendChild(opt);
  }
  if (note){
    note.textContent = masters.length ? 'Se importan como snapshot al evento activo; ventas pasadas no cambian.' : 'No hay extras maestros activos. Créelos en Gestión Operativa → Catálogos → Extras.';
  }
}

async function importMasterExtraToEventPOS(){
  const ev = await getActiveEventPOS();
  if (!ev){ alert('Activa un evento para importar un Extra maestro.'); return; }
  const sel = document.getElementById('extra-master-select');
  const stockEl = document.getElementById('extra-master-stock');
  const masterId = parseInt(String(sel?.value || '0'), 10);
  if (!masterId){ alert('Selecciona un Extra maestro.'); return; }
  const stock = Number(String(stockEl?.value || '').replace(',', '.'));
  if (!Number.isFinite(stock) || stock < 0){ alert('Cantidad inicial inválida.'); return; }
  const masters = (await getAllMasterExtrasSafePOS()).map(normalizeMasterExtraPOS).filter(Boolean);
  const master = masters.find(x => Number(x.id) === Number(masterId));
  if (!master || master.active === false){ alert('Extra maestro no disponible.'); return; }

  ensureEventExtraSeqPOS(ev);
  const extras = sanitizeExtrasPOS(ev.extras);
  const key = normKeyPOS(master.name);
  let x = extras.find(z => normKeyPOS(z.name) === key);
  const nowIso = new Date().toISOString();
  if (x){
    x.active = true;
    x.catalogExtraId = master.id;
    x.unitPrice = master.unitPrice;
    x.unitCost = master.unitCost;
    x.lowStockAlert = master.lowStockAlert;
    x.stock = Number(x.stock || 0) + stock;
    x.updatedAt = nowIso;
  } else {
    ev.extraSeq = safeInt(ev.extraSeq, 0) + 1;
    x = {
      id: ev.extraSeq,
      catalogExtraId: master.id,
      name: master.name,
      stock,
      unitCost: master.unitCost,
      unitPrice: master.unitPrice,
      lowStockAlert: master.lowStockAlert,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      source: 'catalogos_extras'
    };
    extras.push(x);
  }
  ev.extras = extras;
  await put('events', ev);
  if (sel) sel.value = '';
  if (stockEl) stockEl.value = '';
  await renderExtrasUI();
  await refreshProductSelect({ keepSelection:true });
  toast('Extra maestro agregado al evento');
}

async function renderExtrasUI(){
  const label = document.getElementById('extras-event-label');
  const note = document.getElementById('extras-disabled-note');
  const listEl = document.getElementById('extras-list');

  const ev = await getActiveEventPOS();
  const enabled = !!ev;

  if (label) label.textContent = enabled ? (ev.name || '—') : '—';
  if (note) note.style.display = enabled ? 'none' : 'block';

  const idsToDisable = ['extra-name','extra-stock','extra-cost','extra-price','extra-low','btn-save-extra','extra-master-select','extra-master-stock','btn-import-master-extra'];
  for (const id of idsToDisable){
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  }

  try{ await renderMasterExtrasImportPOS(enabled ? ev : null); }catch(e){ console.warn('No se pudo cargar Extras maestros', e); }

  if (!listEl) return;

  if (!enabled){
    listEl.innerHTML = '<div class="muted">Activa un evento para gestionar Extras.</div>';
    resetExtraFormPOS();
    return;
  }

  ensureEventExtraSeqPOS(ev);
  const extras = sanitizeExtrasPOS(ev.extras).filter(x=>x.active!==false);

  if (!extras.length){
    listEl.innerHTML = '<div class="muted">Aún no hay Extras en este evento.</div>';
    return;
  }

  extras.sort((a,b)=> a.name.localeCompare(b.name));

  const rows = extras.map(x=>{
    const low = (x.stock <= x.lowStockAlert && x.stock > 0);
    const out = (x.stock <= 0);
    const cls = ['extra-row', low?'low':'', out?'out':''].filter(Boolean).join(' ');
    const flags = out ? '<span class="pill danger">SIN STOCK</span>' : (low ? '<span class="pill warn">BAJO</span>' : '');
    return `
      <div class="${cls}" data-id="${x.id}">
        <div class="extra-col extra-name"><strong>${escapeHtml(x.name)}</strong> ${flags}</div>
        <div class="extra-col extra-cost">C$${fmt(x.unitCost)}</div>
        <div class="extra-col extra-price">C$${fmt(x.unitPrice)}</div>
        <div class="extra-col extra-stock"><span class="stockpill ${low?'low':''}"><strong>${x.stock}</strong></span></div>
        <div class="extra-actions">
          <button class="btn-small extra-edit" data-action="edit" data-id="${x.id}">Editar</button>
          <button class="btn-small btn-ok extra-restock" data-action="restock" data-id="${x.id}">Agregar</button>
          <button class="btn-small btn-danger extra-del" data-action="del" data-id="${x.id}">Eliminar</button>
        </div>
      </div>`;
  }).join('');

  listEl.innerHTML = rows;
}

async function onSaveExtraPOS(){
  const ev = await getActiveEventPOS();
  if (!ev){
    alert('Debes activar un evento para crear Extras.');
    return;
  }

  const name = (document.getElementById('extra-name')?.value || '').trim();
  const stock = parseFloat(document.getElementById('extra-stock')?.value || '');
  const unitCost = parseFloat(document.getElementById('extra-cost')?.value || '');
  const unitPrice = parseFloat(document.getElementById('extra-price')?.value || '');
  const lowDefault = safeInt(document.getElementById('extra-low-default')?.value, 5);
  const lowStockAlert = safeInt(document.getElementById('extra-low')?.value, lowDefault);

  if (!name){ alert('Nombre de Extra es obligatorio'); return; }
  if (!Number.isFinite(stock) || stock < 0){ alert('Stock/Cantidad debe ser 0 o mayor'); return; }
  if (!Number.isFinite(unitCost) || unitCost < 0){ alert('Costo unitario es obligatorio (>= 0)'); return; }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0){ alert('Precio unitario es obligatorio (> 0)'); return; }

  ensureEventExtraSeqPOS(ev);
  const extras = sanitizeExtrasPOS(ev.extras);

  const nowIso = new Date().toISOString();

  if (editingExtraIdPOS){
    const x = extras.find(z => Number(z.id) === Number(editingExtraIdPOS));
    if (!x){
      alert('No se encontró el Extra a editar (posible cambio de evento).');
      resetExtraFormPOS();
      await renderExtrasUI();
      return;
    }
    x.name = name;
    x.stock = stock;
    x.unitCost = unitCost;
    x.unitPrice = unitPrice;
    x.lowStockAlert = (lowStockAlert>0?lowStockAlert:5);
    x.updatedAt = nowIso;
  } else {
    ev.extraSeq = safeInt(ev.extraSeq, 0) + 1;
    const newId = ev.extraSeq;
    extras.push({
      id: newId,
      name,
      stock,
      unitCost,
      unitPrice,
      lowStockAlert: (lowStockAlert>0?lowStockAlert:5),
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }

  ev.extras = extras;
  await put('events', ev);

  resetExtraFormPOS();
  await renderExtrasUI();
  await refreshProductSelect({ keepSelection:true });
  toast('Extra guardado');
}

async function onExtrasListClickPOS(e){
  const btn = e.target.closest('button');
  if (!btn) return;

  const action = btn.dataset.action;
  const extraId = parseInt(btn.dataset.id || '0', 10);
  if (!extraId) return;

  const ev = await getActiveEventPOS();
  if (!ev) return;

  ensureEventExtraSeqPOS(ev);
  const extras = sanitizeExtrasPOS(ev.extras);
  const x = extras.find(z => Number(z.id) === Number(extraId));
  if (!x) return;

  if (action === 'edit'){
    editingExtraIdPOS = extraId;
    const name = document.getElementById('extra-name');
    const stock = document.getElementById('extra-stock');
    const cost = document.getElementById('extra-cost');
    const price = document.getElementById('extra-price');
    const low = document.getElementById('extra-low');
    if (name) name.value = x.name;
    if (stock) stock.value = x.stock;
    if (cost) cost.value = x.unitCost;
    if (price) price.value = x.unitPrice;
    if (low) low.value = x.lowStockAlert;
    const btnCancel = document.getElementById('btn-cancel-extra');
    if (btnCancel) btnCancel.style.display = 'inline-block';
    return;
  }

  if (action === 'restock'){
    const raw = prompt(`Agregar stock a "${x.name}". Cantidad a sumar:`, '0');
    if (raw == null) return;
    const add = parseFloat(raw);
    if (!Number.isFinite(add) || add <= 0){ alert('Cantidad no válida'); return; }
    x.stock = Number(x.stock || 0) + add;
    x.updatedAt = new Date().toISOString();
    ev.extras = extras;
    await put('events', ev);
    await renderExtrasUI();
    await refreshProductSelect({ keepSelection:true });
    toast('Stock actualizado');
    return;
  }

  if (action === 'del'){
    const ok = confirm(`Eliminar Extra "${x.name}" del evento. No se borran ventas ya registradas. ¿Continuar?`);
    if (!ok) return;
    ev.extras = extras.filter(z => Number(z.id) !== Number(extraId));
    await put('events', ev);
    resetExtraFormPOS();
    await renderExtrasUI();
    await refreshProductSelect({ keepSelection:true });
    toast('Extra eliminado');
    return;
  }
}

async function revertExtraStockAfterSaleDeletePOS(sale){
  try{
    if (!sale || !sale.extraId || !sale.eventId) return;
    const evs = await getAll('events');
    const ev = evs.find(e => e.id === sale.eventId) || null;
    if (!ev) return;
    ensureEventExtraSeqPOS(ev);
    const extras = sanitizeExtrasPOS(ev.extras);
    const x = extras.find(z => Number(z.id) === Number(sale.extraId));
    if (!x) return;
    const q = Number(sale.qty || 0);
    x.stock = Number(x.stock || 0) + q;
    x.updatedAt = new Date().toISOString();
    ev.extras = extras;
    await put('events', ev);
    // refrescar UI si este es el evento activo
    const cur = await getMeta('currentEventId');
    if (cur && Number(cur) === Number(ev.id)){
      try{ await renderExtrasUI(); }catch(e){}
      try{ await refreshProductSelect({ keepSelection:true }); }catch(e){}
    }
  }catch(err){
    console.warn('No se pudo revertir stock de Extra al borrar venta', err);
  }
}

// Alias por compatibilidad (evitar regresiones por nombre)
async function revertExtraStockForSaleDeletePOS(sale){
  return revertExtraStockAfterSaleDeletePOS(sale);
}

// Inventory logic
async function getInventoryEntries(eventId){ const all = await getAll('inventory'); return all.filter(i=>i.eventId===eventId); }
async function getInventoryInit(eventId, productId){ const list = (await getInventoryEntries(eventId)).filter(i=>i.productId===productId && i.type==='init'); return list.length ? list.sort((a,b)=> (a.id-b.id))[list.length-1] : null; }
async function setInitialStock(eventId, productId, qty){ let init = await getInventoryInit(eventId, productId); if (init){ init.qty = qty; init.time = new Date().toISOString(); await put('inventory', init); } else { await put('inventory', {eventId, productId, type:'init', qty, notes:'Inicial', time:new Date().toISOString()}); } }
async function addRestock(eventId, productId, qty, extra){
  if (qty<=0) throw new Error('Reposición debe ser > 0');
  const row = {eventId, productId, type:'restock', qty, notes:'Reposición', time:new Date().toISOString()};
  if (extra && typeof extra === 'object') {
    try { Object.assign(row, extra); } catch {}
  }
  await put('inventory', row);
}

async function addAdjust(eventId, productId, qty, notes){ if (!qty) throw new Error('Ajuste no puede ser 0'); await put('inventory', {eventId, productId, type:'adjust', qty, notes: notes||'Ajuste', time:new Date().toISOString()}); }
async function computeStock(eventId, productRef){
  const evId = Number(eventId);
  const products = await getAll('products');
  let product = null;
  if (productRef && typeof productRef === 'object') product = productRef;
  else {
    const raw = String(productRef == null ? '' : productRef).trim();
    product = findCatalogProductByStableIdPOS(products, raw)
      || (Number.isFinite(Number(raw)) ? (products || []).find(p => Number(p && p.id) === Number(raw)) : null);
  }
  if (!product) return 0;

  const internalId = catalogProductInternalIdPOS(product);
  const stableId = catalogProductStableIdPOS(product);
  if (!internalId || !stableId) return 0;

  const inv = await getInventoryEntries(evId);
  const ledger = (Array.isArray(inv) ? inv : [])
    .filter(i => i && (Number(i.productId) === internalId || String(i.productId || '').trim() === stableId))
    .reduce((a,b)=> a + (Number(b && b.qty) || 0), 0);

  const allSales = await getAll('sales');
  const salesForProduct = (Array.isArray(allSales) ? allSales : [])
    .filter(s => s && Number(s.eventId) === evId && saleMatchesCatalogProductPOS(s, product));

  // Compatibilidad: event.fractionBatches solo representa Vaso ya convertido/disponible en flujos viejos.
  const isVaso = normName(product.name || product.nombre || '') === 'vaso';
  if (isVaso){
    try{
      const ev = await getEventByIdPOS(evId).catch(()=>null);
      const legacyBatches = sanitizeFractionBatches(ev && ev.fractionBatches);
      const legacyRemaining = legacyBatches.reduce((a,b)=> a + safeInt(b && b.cupsRemaining, 0), 0);
      const normalSold = salesForProduct
        .filter(s => !isCupSaleRecord(s))
        .reduce((a,b)=> a + (Number(b && b.qty) || 0), 0);
      const vasoOut = ledger + legacyRemaining - normalSold;
      return Number.isFinite(vasoOut) ? vasoOut : 0;
    }catch(_){ }
  }

  const sold = salesForProduct.reduce((a,b)=> a + (Number(b && b.qty) || 0), 0);
  const out = ledger - sold;
  return Number.isFinite(out) ? out : 0;
}

function saleCostFieldValuePOS(value){
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getProductStoredUnitCostPOS(product){
  if (!product || typeof product !== 'object') return 0;
  const candidates = [
    product.unitCost, product.costoUnitario, product.costoUnidad,
    product.costPerUnit, product.sourceUnitCost
  ];
  for (const c of candidates){
    const n = saleCostFieldValuePOS(c);
    if (n > 0) return n;
  }
  return 0;
}

function saleCostFromFieldsPOS(obj){
  if (!obj || typeof obj !== 'object') return 0;
  const direct = [
    obj.unitCost, obj.costoUnitario, obj.costoUnidad, obj.costPerUnit,
    obj.costoUnitarioDestino, obj.costoUnitarioCalculado, obj.targetUnitCost,
    obj.sourceUnitCost, obj.costoPromedio, obj.averageUnitCost
  ];
  for (const c of direct){
    const n = saleCostFieldValuePOS(c);
    if (n > 0) return n;
  }

  const qty = Math.abs(Number(obj.qty ?? obj.cantidad ?? obj.units ?? obj.stock ?? 0));
  const totalCandidates = [
    obj.costoTotal, obj.costTotal, obj.lineCost, obj.totalCost,
    obj.costoTotalAsignado, obj.costoFinalTotal, obj.costoOrigenTotal
  ];
  if (qty > 0){
    for (const total of totalCandidates){
      const t = saleCostFieldValuePOS(total);
      if (t > 0) return round2(t / qty);
    }
  }
  return 0;
}

function getSaleCostUnitSnapshotPOS(sale){
  if (!sale || typeof sale !== 'object') return 0;
  const candidates = [
    sale.costPerUnit, sale.costUnitSnapshot, sale.unitCostSnapshot, sale.costoUnitarioSnapshot,
    sale.costoUnitario, sale.unitCost, sale.costUnit,
    sale.productSnapshot && sale.productSnapshot.unitCost,
    sale.productSnapshot && sale.productSnapshot.costPerUnit,
    sale.productSnapshot && sale.productSnapshot.costoUnitario
  ];
  let zeroSeen = false;
  for (const c of candidates){
    const n = Number(c);
    if (!Number.isFinite(n) || n < 0) continue;
    if (Math.abs(n) > 1e-9) return round2(n);
    zeroSeen = true;
  }
  return zeroSeen ? 0 : 0;
}

function getSaleLineCostSnapshotPOS(sale){
  if (!sale || typeof sale !== 'object') return 0;
  const candidates = [sale.lineCost, sale.costTotal, sale.costoTotal, sale.totalCost, sale.costoTotalSnapshot];
  let zeroSeen = false;
  for (const c of candidates){
    const n = Number(c);
    if (!Number.isFinite(n)) continue;
    if (Math.abs(n) > 1e-9) return round2(n);
    zeroSeen = true;
  }
  if (zeroSeen) return 0;
  const cpu = getSaleCostUnitSnapshotPOS(sale);
  const qty = Number(sale.qty);
  if (Number.isFinite(cpu) && Number.isFinite(qty)) return round2(cpu * qty);
  return 0;
}

function buildSaleEconomicSnapshotPOS({ unitPrice, qty, discount, total, unitCost, costSource, courtesy, isReturn }){
  const q = Number(qty) || 0;
  const absQty = Math.abs(q);
  const price = round2(unitPrice || 0);
  const disc = round2(discount || 0);
  const saleTotal = round2(total || 0);
  const costUnit = round2(unitCost || 0);
  const costTotal = round2(costUnit * q);
  const profit = round2(saleTotal - costTotal);
  const source = String(costSource || '').trim();
  const warnNoCost = !(costUnit > 0);

  return {
    subtotal: round2(price * absQty),
    grossTotal: round2(price * absQty),
    discountTotal: disc,
    saleNet: saleTotal,
    ventaNeta: saleTotal,
    netSale: saleTotal,
    costPerUnit: costUnit,
    costUnitSnapshot: costUnit,
    unitCostSnapshot: costUnit,
    costoUnitarioSnapshot: costUnit,
    costoUnitario: costUnit,
    costTotal,
    costoTotal: costTotal,
    costoTotalSnapshot: costTotal,
    lineCost: costTotal,
    lineProfit: profit,
    utility: profit,
    utilidad: profit,
    profit,
    costSource: source || (warnNoCost ? 'sin_costo_confiable' : ''),
    costSourceSnapshot: source || (warnNoCost ? 'sin_costo_confiable' : ''),
    costWarning: warnNoCost ? 'Venta guardada sin costo unitario confiable; utilidad de esta venta queda calculada con costo 0.' : '',
    isCourtesy: !!courtesy,
    courtesy: !!courtesy,
    isReturn: !!isReturn
  };
}

async function getLotFifoUnitCostForSalePOS(eventId, productId, productName){
  try{
    const evId = Number(eventId);
    const pid = Number(productId);
    if (!Number.isFinite(evId) || evId <= 0 || !Number.isFinite(pid) || pid <= 0) return 0;

    const entries = await getInventoryEntries(evId);
    let weightedCost = 0;
    let weightedQty = 0;
    for (const e of (Array.isArray(entries) ? entries : [])){
      if (!e || Number(e.productId) !== pid) continue;
      if (e.type !== 'restock') continue;
      const looksLot = !!(e.loteCodigo || e.loteId || e.loteCargaId || e.loteGroupKey || e.source === 'lote');
      if (!looksLot) continue;
      const q = Math.max(0, Number(e.qty) || 0);
      const c = saleCostFromFieldsPOS(e);
      if (!(q > 0) || !(c > 0)) continue;
      weightedQty += q;
      weightedCost += q * c;
    }
    if (weightedQty > 0 && weightedCost > 0) return round2(weightedCost / weightedQty);

    // Segundo intento defensivo: algunos lotes guardan el costo en arcano33_lotes, no en inventory.
    const lotes = readLotesLS_POS();
    if (!Array.isArray(lotes) || !lotes.length) return 0;
    const products = await getAll('products');
    let lotWeightedCost = 0;
    let lotWeightedQty = 0;
    for (const l of lotes){
      if (!l || Number(l.assignedEventId) !== evId) continue;
      const rows = lotesPOSContractRowsPOS(l);
      for (const row of rows){
        const prod = resolveProductFromLoteContractRowPOS(row, products);
        if (!prod || Number(prod.id) !== pid) continue;
        const q = lotesPOSQtyFromContractRowPOS(row);
        const c = saleCostFromFieldsPOS(row) || saleCostFromFieldsPOS(l);
        if (!(q > 0) || !(c > 0)) continue;
        lotWeightedQty += q;
        lotWeightedCost += q * c;
      }
    }
    if (lotWeightedQty > 0 && lotWeightedCost > 0) return round2(lotWeightedCost / lotWeightedQty);
  }catch(err){
    console.warn('No se pudo leer costo unitario FIFO/Lotes para venta', err);
  }
  return 0;
}

async function getReempaqueUnitCostForSalePOS(eventId, productId){
  try{
    const evId = Number(eventId);
    const pid = Number(productId);
    if (!Number.isFinite(evId) || evId <= 0 || !Number.isFinite(pid) || pid <= 0) return 0;
    const entries = await getInventoryEntries(evId);
    let qtyCost = 0;
    let qtyTotal = 0;

    for (const e of (entries || [])){
      if (!e || Number(e.productId) !== pid) continue;
      const isReempaqueDest =
        e.reempaqueRole === 'destino' &&
        (e.source === 'reempaque' || e.sourceType === 'REEMPAQUE' || e.reempaqueId);
      if (!isReempaqueDest) continue;

      const q = Math.max(0, Number(e.qty) || 0);
      const c = saleCostFromFieldsPOS(e);
      if (!(q > 0) || !(c > 0)) continue;
      qtyTotal += q;
      qtyCost += q * c;
    }

    if (qtyTotal > 0 && qtyCost > 0) return round2(qtyCost / qtyTotal);
  }catch(err){
    console.warn('No se pudo leer costo unitario desde Reempaque para venta', err);
  }
  return 0;
}

async function resolveSaleUnitCostPOS(eventId, productId, productName, productObj){
  // Etapa 5/6: costo dinámico por prioridad, sin fallback accidental a Galón/Pulso.
  const fromLotFifo = await getLotFifoUnitCostForSalePOS(eventId, productId, productName);
  if (fromLotFifo > 0) return { unitCost: fromLotFifo, source: 'lote_fifo' };

  const fromReempaque = await getReempaqueUnitCostForSalePOS(eventId, productId);
  if (fromReempaque > 0) return { unitCost: fromReempaque, source: 'reempaque' };

  const fromProduct = getProductStoredUnitCostPOS(productObj);
  if (fromProduct > 0) return { unitCost: fromProduct, source: 'producto_catalogo' };

  const fromCalc = saleCostFieldValuePOS(getCostoUnitarioProducto(productName));
  if (fromCalc > 0) return { unitCost: fromCalc, source: 'calculadora_legacy' };

  return { unitCost: 0, source: 'sin_costo_confiable' };
}

function reempaqueMovementErrorPOS(msg){
  return new Error(String(msg || 'No se pudo registrar Reempaque.'));
}

function reempaqueInventoryQtyPOS(value){
  const n = reempaqueNumPOS(value, 0);
  if (!Number.isFinite(n)) return 0;
  return reempaqueRound4POS(n);
}

function reempaqueFindProductByIdPOS(products, productId){
  const sid = String(productId ?? '').trim();
  if (!sid) return null;
  return (Array.isArray(products) ? products : []).find(p => p && String(p.id) === sid) || null;
}

function reempaqueMovementNotePOS(kind, srcName, dstName, note){
  const base = kind === 'entrada' ? 'Reempaque entrada' : 'Reempaque salida';
  const pair = `${srcName || 'Origen'} → ${dstName || 'Destino'}`;
  const extra = String(note || '').trim();
  return extra ? `${base}: ${pair}. ${extra}` : `${base}: ${pair}`;
}

function reempaqueCommitInventoryMovementPOS(record, sourceRow, targetRow){
  return new Promise((resolve, reject)=>{
    try{
      if (!db) throw reempaqueMovementErrorPOS('Base de datos no disponible.');
      const tr = db.transaction(['inventory', REEMPAQUE_STORE_POS], 'readwrite');
      const invStore = tr.objectStore('inventory');
      const rpStore = tr.objectStore(REEMPAQUE_STORE_POS);
      let srcKey = null;
      let dstKey = null;
      let recordQueued = false;

      function queueRecordIfReady(){
        if (recordQueued || srcKey === null || dstKey === null) return;
        recordQueued = true;
        const finalRecord = {
          ...record,
          inventoryMovementIds: [srcKey, dstKey],
          inventorySourceMovementId: srcKey,
          inventoryTargetMovementId: dstKey,
          movimientoInventarioIds: [srcKey, dstKey],
          movimientoOrigenId: srcKey,
          movimientoDestinoId: dstKey,
          updatedAt: reempaqueNowISOPOS()
        };
        const r = rpStore.put(finalRecord);
        r.onerror = ()=> { try{ tr.abort(); }catch(_){ } };
        r.onsuccess = ()=> { record = finalRecord; };
      }

      const srcReq = invStore.add(sourceRow);
      srcReq.onsuccess = ()=>{ srcKey = srcReq.result; queueRecordIfReady(); };
      srcReq.onerror = ()=>{ try{ tr.abort(); }catch(_){ } };

      const dstReq = invStore.add(targetRow);
      dstReq.onsuccess = ()=>{ dstKey = dstReq.result; queueRecordIfReady(); };
      dstReq.onerror = ()=>{ try{ tr.abort(); }catch(_){ } };

      tr.oncomplete = ()=> resolve(record);
      tr.onerror = ()=> reject(tr.error || reempaqueMovementErrorPOS('No se pudo guardar el movimiento de inventario.'));
      tr.onabort = ()=> reject(tr.error || reempaqueMovementErrorPOS('No se pudo guardar el movimiento de inventario.'));
    }catch(err){
      reject(err);
    }
  });
}


function reempaqueCommitMultipleInventoryMovementPOS(record, sourceRow, targetRows){
  return new Promise((resolve, reject)=>{
    try{
      if (!db) throw reempaqueMovementErrorPOS('Base de datos no disponible.');
      const rows = Array.isArray(targetRows) ? targetRows : [];
      if (!rows.length) throw reempaqueMovementErrorPOS('Reempaque múltiple sin destinos.');
      const tr = db.transaction(['inventory', REEMPAQUE_STORE_POS], 'readwrite');
      const invStore = tr.objectStore('inventory');
      const rpStore = tr.objectStore(REEMPAQUE_STORE_POS);
      let srcKey = null;
      const targetKeys = [];
      let recordQueued = false;

      function queueRecordIfReady(){
        const readyTargets = targetKeys.filter(k => k !== null && typeof k !== 'undefined').length;
        if (recordQueued || srcKey === null || readyTargets !== rows.length) return;
        recordQueued = true;
        const finalRecord = {
          ...record,
          inventoryMovementIds: [srcKey].concat(targetKeys),
          inventorySourceMovementId: srcKey,
          inventoryTargetMovementIds: targetKeys,
          movimientoInventarioIds: [srcKey].concat(targetKeys),
          movimientoOrigenId: srcKey,
          movimientoDestinoIds: targetKeys,
          updatedAt: reempaqueNowISOPOS()
        };
        const r = rpStore.put(finalRecord);
        r.onerror = ()=> { try{ tr.abort(); }catch(_){ } };
        r.onsuccess = ()=> { record = finalRecord; };
      }

      const srcReq = invStore.add(sourceRow);
      srcReq.onsuccess = ()=>{ srcKey = srcReq.result; queueRecordIfReady(); };
      srcReq.onerror = ()=>{ try{ tr.abort(); }catch(_){ } };

      rows.forEach((row, idx)=>{
        const req = invStore.add(row);
        req.onsuccess = ()=>{
          targetKeys[idx] = req.result;
          if (targetKeys.filter(k => k !== null && typeof k !== 'undefined').length === rows.length){
            queueRecordIfReady();
          }
        };
        req.onerror = ()=>{ try{ tr.abort(); }catch(_){ } };
      });

      tr.oncomplete = ()=> resolve(record);
      tr.onerror = ()=> reject(tr.error || reempaqueMovementErrorPOS('No se pudo guardar el movimiento múltiple de inventario.'));
      tr.onabort = ()=> reject(tr.error || reempaqueMovementErrorPOS('No se pudo guardar el movimiento múltiple de inventario.'));
    }catch(err){
      reject(err);
    }
  });
}

async function reempaqueApplyMultipleMovementPOS(input={}){
  if (!db) await openDB();
  const base = await reempaquePrepareMultiplePayloadPOS(input || {});
  const validation = reempaqueValidateMultipleRecordPOS(base);
  if (!validation.ok){
    throw reempaqueMovementErrorPOS('Datos incompletos para registrar Reempaque múltiple: ' + validation.errors.join(', '));
  }

  const eventId = Number(base.eventId ?? base.eventoId);
  if (!Number.isFinite(eventId) || !(eventId > 0)){
    throw reempaqueMovementErrorPOS('Selecciona un evento.');
  }

  const sourceId = Number(base.sourceProductId ?? base.productoOrigenId ?? (base.sourceProduct && base.sourceProduct.id));
  if (!Number.isFinite(sourceId) || !(sourceId > 0)){
    throw reempaqueMovementErrorPOS('El producto origen no existe en el catálogo.');
  }

  const products = await getAll('products').catch(()=>[]);
  const sourceProduct = reempaqueFindProductByIdPOS(products, sourceId);
  if (!sourceProduct){
    throw reempaqueMovementErrorPOS('El producto origen no existe en el catálogo.');
  }

  const qtySource = reempaqueInventoryQtyPOS(base.cantidadOrigen ?? base.sourceQty ?? base.qtyOrigen);
  if (!(qtySource > 0)){
    throw reempaqueMovementErrorPOS('Cantidad origen mayor que 0.');
  }

  const stockSource = reempaqueInventoryQtyPOS(await computeStock(eventId, sourceId));
  if ((stockSource + 0.0001) < qtySource){
    throw reempaqueMovementErrorPOS('No hay inventario suficiente del producto origen.');
  }

  const now = reempaqueNowISOPOS();
  const srcName = String(sourceProduct.name || base.sourceProductName || base.productoOrigen || 'Origen').trim();
  const note = String(base.nota || base.note || '').trim();
  const sourceCapacityMl = reempaqueCapacityMlFromProductPOS(sourceProduct) || base.capacidadOrigenMl || null;
  const destinos = (Array.isArray(base.destinos) ? base.destinos : []).map((d, idx)=>({ ...d, index: idx }));
  if (!destinos.length){
    throw reempaqueMovementErrorPOS('Agrega al menos un destino.');
  }

  const targetRows = [];
  const targetIds = [];
  const targetNames = [];
  for (const d of destinos){
    const targetId = Number(d.targetProductId ?? d.productoDestinoId ?? (d.targetProduct && d.targetProduct.id));
    if (!Number.isFinite(targetId) || !(targetId > 0)){
      throw reempaqueMovementErrorPOS('Un producto destino no existe en el catálogo.');
    }
    if (targetId === sourceId){
      throw reempaqueMovementErrorPOS('El producto origen y destino no deberían ser el mismo.');
    }
    const targetProduct = reempaqueFindProductByIdPOS(products, targetId);
    if (!targetProduct){
      throw reempaqueMovementErrorPOS('Un producto destino no existe en el catálogo.');
    }
    const dstName = String(targetProduct.name || d.targetProductName || d.productoDestino || 'Destino').trim();
    const qtyTarget = reempaqueInventoryQtyPOS(d.cantidadCreada ?? d.cantidadCreadaDestino ?? d.cantidadDestino ?? d.targetQty ?? d.qty ?? d.cantidad);
    const unitTarget = reempaqueMoneyPOS(d.costoUnitarioCalculado ?? d.costoUnitarioDestino ?? d.targetUnitCost ?? 0);
    const costoLiquidoUnitario = reempaqueMoneyPOS(d.costoLiquidoUnitario ?? d.costoUnitarioLiquido ?? 0);
    const costoLiquidoTotal = reempaqueMoneyPOS(d.costoLiquidoTotal ?? d.costoLiquidoAsignado ?? (costoLiquidoUnitario > 0 && qtyTarget > 0 ? costoLiquidoUnitario * qtyTarget : 0));
    const costoAdicionalUnitario = reempaqueMoneyPOS(d.costoAdicionalUnitario ?? d.costoEmpaqueUnitario ?? 0);
    const costoAdicionalTotal = reempaqueMoneyPOS(d.costoAdicionalTotal ?? d.costoEmpaqueTotal ?? (costoAdicionalUnitario > 0 && qtyTarget > 0 ? costoAdicionalUnitario * qtyTarget : 0));
    const costoAsignado = reempaqueMoneyPOS(d.costoTotalAsignado ?? (unitTarget > 0 && qtyTarget > 0 ? unitTarget * qtyTarget : 0));
    const tipoDestinoRaw = String(d.tipoDestino ?? d.destinoTipo ?? (d.productoNuevoCreado ? 'NUEVO' : (d.destinoNuevo || d.productoNuevoDestino ? 'NUEVO' : 'EXISTENTE'))).toUpperCase();
    const tipoDestino = (tipoDestinoRaw === 'NUEVO' || tipoDestinoRaw === 'NUEVO_EXISTENTE') ? tipoDestinoRaw : 'EXISTENTE';
    if (!(qtyTarget > 0)){
      throw reempaqueMovementErrorPOS('Cada destino debe tener cantidad creada mayor que 0.');
    }
    targetIds.push(targetId);
    targetNames.push(dstName);
    targetRows.push({
      eventId,
      source: 'reempaque',
      sourceType: 'REEMPAQUE',
      reempaqueId: base.id,
      tipoDestino,
      destinoTipo: tipoDestino,
      productoNuevoDestino: !!(d.productoNuevoDestino || d.destinoNuevo || tipoDestino === 'NUEVO' || tipoDestino === 'NUEVO_EXISTENTE'),
      productoNuevoCreado: !!(d.productoNuevoCreado || tipoDestino === 'NUEVO'),
      precioVentaDestino: reempaqueMoneyPOS(d.precioVentaDestino ?? (targetProduct && targetProduct.price)),
      time: now,
      createdAt: now,
      affectsSales: false,
      affectsCash: false,
      affectsAccountingIncome: false,
      productId: targetId,
      productName: dstName,
      type: 'adjust',
      qty: qtyTarget,
      notes: reempaqueMovementNotePOS('entrada', srcName, dstName, note),
      reempaqueRole: 'destino',
      reempaqueMode: 'MULTIPLE',
      reempaqueDestinoIndex: d.index,
      costoLiquidoUnitario,
      costoUnitarioLiquido: costoLiquidoUnitario,
      costoLiquidoTotal,
      costoLiquidoAsignado: costoLiquidoTotal,
      costoAdicionalUnitario,
      costoEmpaqueUnitario: costoAdicionalUnitario,
      costoAdicionalTotal,
      costoEmpaqueTotal: costoAdicionalTotal,
      costoUnitarioDestino: unitTarget,
      costoTotalAsignado: costoAsignado,
      volumenTotalDestinoMl: reempaquePositivePOS(d.volumenTotalDestinoMl),
      mlPorUnidad: reempaquePositivePOS(d.mlPorUnidad ?? d.capacidadDestinoMl),
      sourceProductId: sourceId,
      sourceProductName: srcName
    });
  }

  const record = {
    ...base,
    eventId,
    eventoId: eventId,
    sourceProductId: sourceId,
    productoOrigenId: sourceId,
    sourceProductName: srcName,
    productoOrigenNombre: srcName,
    productoOrigen: srcName,
    sourceProduct: { id: sourceId, name: srcName, capacityMl: sourceCapacityMl },
    capacidadOrigenMl: sourceCapacityMl,
    capacidadVolumenOrigen: sourceCapacityMl,
    estado: 'REGISTRADO',
    movimientoAplicado: true,
    movimientoTipo: 'INVENTARIO',
    movimientoOrigen: 'REEMPAQUE',
    afectaVentas: false,
    afectaCaja: false,
    afectaEfectivo: false,
    afectaDiarioIngreso: false,
    noVenta: true,
    noCaja: true,
    stockOrigenAntes: stockSource,
    stockOrigenDespues: reempaqueRound4POS(stockSource - qtySource),
    deltaOrigen: reempaqueRound4POS(-qtySource),
    deltaDestinos: targetRows.map(row => ({
      productId: row.productId,
      productName: row.productName,
      qty: row.qty,
      tipoDestino: row.tipoDestino || row.destinoTipo || 'EXISTENTE',
      productoNuevoDestino: !!row.productoNuevoDestino,
      productoNuevoCreado: !!row.productoNuevoCreado,
      precioVentaDestino: row.precioVentaDestino || 0,
      costoLiquidoUnitario: row.costoLiquidoUnitario,
      costoAdicionalUnitario: row.costoAdicionalUnitario,
      costoUnitarioDestino: row.costoUnitarioDestino
    })),
    targetProductIds: targetIds,
    targetProductNames: targetNames,
    etapa: 'REEMPAQUE_MULTIPLE_BASE_INTERNA',
    updatedAt: now,
    createdAt: base.createdAt || now
  };

  const sourceRow = {
    eventId,
    source: 'reempaque',
    sourceType: 'REEMPAQUE',
    reempaqueId: record.id,
    time: now,
    createdAt: now,
    affectsSales: false,
    affectsCash: false,
    affectsAccountingIncome: false,
    productId: sourceId,
    productName: srcName,
    type: 'adjust',
    qty: reempaqueRound4POS(-qtySource),
    notes: `Reempaque múltiple salida: ${srcName} → ${targetNames.join(' + ')}` + (note ? `. ${note}` : ''),
    reempaqueRole: 'origen',
    reempaqueMode: 'MULTIPLE',
    costoUnitarioOrigen: base.costoUnitarioOrigen,
    costoOrigenTotal: base.costoOrigenTotal,
    costoTotalOrigen: base.costoTotalOrigen,
    costoPorMl: base.costoPorMl,
    costoLiquidoDistribuido: base.costoLiquidoDistribuido,
    costoAdicionalTotal: base.costoAdicionalTotal,
    costoAdicionalDestinos: base.costoAdicionalDestinos,
    costoTotalDistribuido: base.costoTotalDistribuido,
    costoTotalFinalDestinos: base.costoTotalFinalDestinos,
    costoSobranteMerma: base.costoSobranteMerma,
    mlSobranteMerma: base.mlSobranteMerma,
    targetProductIds: targetIds,
    targetProductNames: targetNames
  };

  return await reempaqueCommitMultipleInventoryMovementPOS(record, sourceRow, targetRows);
}

async function reempaqueApplyMovementPOS(input={}){
  if (reempaqueHasMultipleDestinationsInputPOS(input) || reempaqueIsMultipleRecordPOS(input)){
    return await reempaqueApplyMultipleMovementPOS(input || {});
  }
  if (!db) await openDB();
  const base = input && input.id ? { ...input } : await reempaqueCreateBaseRecordPOS(input || {});
  const validation = reempaqueValidateRecordPOS(base);
  if (!validation.ok){
    throw reempaqueMovementErrorPOS('Datos incompletos para registrar Reempaque.');
  }

  const eventId = Number(base.eventId ?? base.eventoId);
  if (!Number.isFinite(eventId) || !(eventId > 0)){
    throw reempaqueMovementErrorPOS('Selecciona un evento.');
  }

  const sourceId = Number(base.sourceProductId ?? base.productoOrigenId ?? (base.sourceProduct && base.sourceProduct.id));
  const targetId = Number(base.targetProductId ?? base.productoDestinoId ?? (base.targetProduct && base.targetProduct.id));
  if (!Number.isFinite(sourceId) || !(sourceId > 0)){
    throw reempaqueMovementErrorPOS('El producto origen no existe en el catálogo.');
  }
  if (!Number.isFinite(targetId) || !(targetId > 0)){
    throw reempaqueMovementErrorPOS('El producto destino no existe en el catálogo.');
  }
  if (sourceId === targetId){
    throw reempaqueMovementErrorPOS('El producto origen y destino no deberían ser el mismo.');
  }

  const products = await getAll('products').catch(()=>[]);
  const sourceProduct = reempaqueFindProductByIdPOS(products, sourceId);
  const targetProduct = reempaqueFindProductByIdPOS(products, targetId);
  if (!sourceProduct){
    throw reempaqueMovementErrorPOS('El producto origen no existe en el catálogo.');
  }
  if (!targetProduct){
    throw reempaqueMovementErrorPOS('El producto destino no existe en el catálogo.');
  }

  const qtySource = reempaqueInventoryQtyPOS(base.cantidadOrigen ?? base.sourceQty ?? base.qtyOrigen);
  const qtyTarget = reempaqueInventoryQtyPOS(base.cantidadFinalRegistrada ?? base.cantidadCreadaDestino ?? base.cantidadDestino ?? base.targetQty);
  if (!(qtySource > 0)){
    throw reempaqueMovementErrorPOS('Cantidad origen mayor que 0.');
  }
  if (!(qtyTarget > 0)){
    throw reempaqueMovementErrorPOS('Cantidad creada mayor que 0.');
  }

  const stockSource = reempaqueInventoryQtyPOS(await computeStock(eventId, sourceId));
  if ((stockSource + 0.0001) < qtySource){
    throw reempaqueMovementErrorPOS('No hay inventario suficiente del producto origen.');
  }

  const now = reempaqueNowISOPOS();
  const srcName = String(sourceProduct.name || base.sourceProductName || base.productoOrigen || 'Origen').trim();
  const dstName = String(targetProduct.name || base.targetProductName || base.productoDestino || 'Destino').trim();
  const note = String(base.nota || base.note || '').trim();
  const sourceCapacityMl = reempaqueCapacityMlFromProductPOS(sourceProduct) || base.capacidadOrigenMl || null;
  const targetCapacityMl = reempaqueCapacityMlFromProductPOS(targetProduct) || base.capacidadDestinoMl || null;
  const costoUnitarioOrigen = reempaqueMoneyPOS(base.costoUnitarioOrigen ?? base.costoOrigenUnitario ?? base.sourceUnitCost ?? base.unitCostOrigin ?? 0);
  const costoOrigenTotalManual = reempaqueMoneyPOS(base.costoOrigenTotal ?? base.sourceCostTotal ?? 0);
  const costoOrigenTotal = costoOrigenTotalManual > 0
    ? costoOrigenTotalManual
    : ((costoUnitarioOrigen > 0 && qtySource > 0) ? round2(costoUnitarioOrigen * qtySource) : 0);
  const costoAdicionalUnitarioInput = reempaqueMoneyPOS(base.costoAdicionalUnitario ?? base.costoEmpaqueUnitario ?? base.extraUnitCost ?? base.additionalUnitCost ?? 0);
  const costoAdicionalTotalManual = reempaqueMoneyPOS(base.costoAdicionalTotal ?? base.costoEmpaqueTotal ?? base.extraCostTotal ?? 0);
  const costoAdicionalTotal = (costoAdicionalUnitarioInput > 0 && qtyTarget > 0)
    ? round2(costoAdicionalUnitarioInput * qtyTarget)
    : costoAdicionalTotalManual;
  const costoAdicionalUnitario = costoAdicionalUnitarioInput > 0
    ? costoAdicionalUnitarioInput
    : ((qtyTarget > 0 && costoAdicionalTotal > 0) ? round2(costoAdicionalTotal / qtyTarget) : 0);
  const costoLiquidoTotal = costoOrigenTotal;
  const costoLiquidoUnitario = (qtyTarget > 0 && costoLiquidoTotal > 0) ? round2(costoLiquidoTotal / qtyTarget) : 0;
  const costoTotalManual = reempaqueMoneyPOS(base.costoTotalReempaque ?? base.totalCostReempaque ?? 0);
  const costoTotalReempaque = (costoLiquidoTotal > 0 || costoAdicionalTotal > 0)
    ? round2(costoLiquidoTotal + costoAdicionalTotal)
    : costoTotalManual;
  const costoUnitarioDestino = (costoTotalReempaque > 0 && qtyTarget > 0)
    ? round2(costoTotalReempaque / qtyTarget)
    : reempaqueMoneyPOS(base.costoUnitarioDestino ?? base.targetUnitCost ?? 0);

  const record = {
    ...base,
    eventId,
    eventoId: eventId,
    sourceProductId: sourceId,
    productoOrigenId: sourceId,
    sourceProductName: srcName,
    productoOrigenNombre: srcName,
    productoOrigen: srcName,
    sourceProduct: { id: sourceId, name: srcName, capacityMl: sourceCapacityMl },
    capacidadOrigenMl: sourceCapacityMl,
    capacidadVolumenOrigen: sourceCapacityMl,
    targetProductId: targetId,
    productoDestinoId: targetId,
    targetProductName: dstName,
    productoDestinoNombre: dstName,
    productoDestino: dstName,
    targetProduct: { id: targetId, name: dstName, capacityMl: targetCapacityMl },
    capacidadDestinoMl: targetCapacityMl,
    capacidadVolumenDestino: targetCapacityMl,
    cantidadOrigen: qtySource,
    cantidadCreadaDestino: qtyTarget,
    cantidadFinalRegistrada: qtyTarget,
    cantidadSugeridaPorVolumen: base.cantidadSugeridaPorVolumen ?? reempaqueComputeSuggestedQtyByVolumePOS(qtySource, sourceCapacityMl, targetCapacityMl),
    costoUnitarioOrigen,
    costoFuenteOrigen: String(base.costoFuenteOrigen || base.costSourceOrigin || '').trim(),
    costoOrigenTotal,
    costoLiquidoTotal,
    costoLiquidoDistribuido: costoLiquidoTotal,
    costoLiquidoUnitario,
    costoUnitarioLiquido: costoLiquidoUnitario,
    costoAdicionalUnitario,
    costoEmpaqueUnitario: costoAdicionalUnitario,
    costoAdicionalTotal,
    costoEmpaqueTotal: costoAdicionalTotal,
    costoTotalReempaque,
    costoUnitarioDestino,
    estado: 'REGISTRADO',
    movimientoAplicado: true,
    movimientoTipo: 'INVENTARIO',
    movimientoOrigen: 'REEMPAQUE',
    afectaVentas: false,
    afectaCaja: false,
    afectaEfectivo: false,
    afectaDiarioIngreso: false,
    noVenta: true,
    noCaja: true,
    stockOrigenAntes: stockSource,
    stockOrigenDespues: reempaqueRound4POS(stockSource - qtySource),
    deltaOrigen: reempaqueRound4POS(-qtySource),
    deltaDestino: qtyTarget,
    etapa: '4_COSTEO_GENERICO',
    updatedAt: now,
    createdAt: base.createdAt || now
  };

  const common = {
    eventId,
    source: 'reempaque',
    sourceType: 'REEMPAQUE',
    reempaqueId: record.id,
    time: now,
    createdAt: now,
    affectsSales: false,
    affectsCash: false,
    affectsAccountingIncome: false,
    costoTotalReempaque,
    costoUnitarioDestino,
    costoLiquidoTotal,
    costoLiquidoUnitario,
    costoAdicionalUnitario,
    costoAdicionalTotal
  };

  const sourceRow = {
    ...common,
    productId: sourceId,
    productName: srcName,
    type: 'adjust',
    qty: reempaqueRound4POS(-qtySource),
    notes: reempaqueMovementNotePOS('salida', srcName, dstName, note),
    reempaqueRole: 'origen',
    costoUnitarioOrigen,
    costoOrigenTotal,
    costoLiquidoTotal,
    costoLiquidoUnitario,
    costoAdicionalUnitario,
    costoAdicionalTotal,
    targetProductId: targetId,
    targetProductName: dstName
  };

  const targetRow = {
    ...common,
    productId: targetId,
    productName: dstName,
    type: 'adjust',
    qty: qtyTarget,
    notes: reempaqueMovementNotePOS('entrada', srcName, dstName, note),
    reempaqueRole: 'destino',
    costoUnitarioDestino,
    costoLiquidoTotal,
    costoLiquidoUnitario,
    costoAdicionalUnitario,
    costoAdicionalTotal,
    sourceProductId: sourceId,
    sourceProductName: srcName
  };

  return await reempaqueCommitInventoryMovementPOS(record, sourceRow, targetRow);
}

// =========================================================
// Lotes FIFO (Etapa 1: solo cálculo, sin UI)
// - Fuente de verdad: inventory (restock/adjust con loteCargaId/loteGroupKey)
// - Orden FIFO: orden de entrada al evento (time de la carga)
// - No asigna manualmente; solo calcula distribución y sobrantes "unassigned".
// =========================================================

function lotFifoKeyFromProductPOS(product, productId, fallbackName){
  // Identidad FIFO: productId estable manda. El nombre solo conserva históricos sin identidad.
  const stableFromProduct = catalogProductStableIdPOS(product);
  const rawRef = String(productId == null ? '' : productId).trim();
  const rawIsLegacyInternal = /^\d+$/.test(rawRef);
  const stableId = stableFromProduct || (!rawIsLegacyInternal ? rawRef : '');
  if (stableId) return 'PID:' + stableId;

  const name = (product && (product.name || product.nombre)) ? (product.name || product.nombre) : (fallbackName || '');
  const legacyKey = presKeyFromProductNamePOS(name || '');
  if (legacyKey) return legacyKey;

  const internalId = Number(rawRef);
  if (Number.isFinite(internalId) && internalId > 0) return 'PID-LEGACY:' + internalId;
  return '';
}

function lotFifoGroupKeyFromInvEntryPOS(e){
  if (!e) return '';
  // Preferir groupKey explícito (reversos), luego loteCargaId, luego fallback legacy.
  if (e.loteGroupKey != null && String(e.loteGroupKey).trim() !== '') return String(e.loteGroupKey);
  if (e.loteCargaId != null && String(e.loteCargaId).trim() !== '') return String(e.loteCargaId);

  const code = (e.loteCodigo || '').toString().trim();
  const t = (e.time || '').toString();
  const base = (code || '—') + '|' + (t || '');
  return base;
}

function lotFifoTsPOS(v){
  try{
    const t = Date.parse(String(v || ''));
    return Number.isFinite(t) ? t : NaN;
  }catch(_){
    return NaN;
  }
}

async function computeLotFifoForEvent(eventId){
  const evId = Number(eventId);
  if (!Number.isFinite(evId) || evId <= 0) throw new Error('computeLotFifoForEvent: eventId inválido');

  const updatedAt = Date.now();

  const products = await getAll('products');
  const pMap = new Map((products || []).map(p => [Number(p.id), p]));
  const pStableMap = new Map((products || []).map(p => [catalogProductStableIdPOS(p), p]).filter(([id]) => !!id));

  const entries = await getInventoryEntries(evId);
  const inv = Array.isArray(entries) ? entries : [];

  const evidence = { lotIds: new Set(), lotCodes: new Set() };

  const restocks = inv.filter(e => e && e.type === 'restock' && (e.loteCodigo || e.loteId || e.loteCargaId || e.source === 'lote'));
  const hasLotEvidence = restocks.length > 0;

  // Si no hay evidencia de entrada por lote, devolvemos solo el debug "unassigned" (sin asignar consumo a lotes).
  const allSales = await getAll('sales');
  const sales = (allSales || []).filter(s => s && Number(s.eventId) === evId && s.productId != null);

  const soldNeedByKey = {};
  for (const s of sales){
    const stableId = saleStableProductIdPOS(s);
    const internalId = saleInternalProductIdPOS(s);
    const prod = (stableId && pStableMap.get(stableId)) || (internalId && pMap.get(internalId)) || null;
    const identityRef = stableId || internalId || '';
    const key = lotFifoKeyFromProductPOS(prod, identityRef, s.productName || s.productNameSnapshot);
    if (!key) continue;
    const q = Number(s.qty) || 0;
    if (!q) continue;
    soldNeedByKey[key] = (Number(soldNeedByKey[key]) || 0) + q;
  }
  // Incluir también consumos que NO pasan por "sales" pero sí descuentan inventario del evento.
  // Ej: fraccionamiento de galones a vasos (adjust negativo del Galón) o ajustes manuales negativos.
  // Nota: excluimos reversos/ajustes vinculados a lotes para no doble-contar (ya afectan la carga neta del lote).
  for (const e of inv){
    if (!e || e.type !== 'adjust') continue;
    const qtyAdj = Number(e.qty) || 0;
    if (!(qtyAdj < 0)) continue;

    // Si está ligado a un lote (reverso/corrección por lote), NO cuenta como consumo adicional:
    if (e.source === 'lote_reverso' || e.loteCargaId != null || e.loteGroupKey != null) continue;

    const pid = Number(e.productId);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const prod = pMap.get(pid) || null;
    const key = lotFifoKeyFromProductPOS(prod, pid, (prod && prod.name) ? prod.name : '');
    if (!key) continue;

    soldNeedByKey[key] = (Number(soldNeedByKey[key]) || 0) + Math.abs(qtyAdj);
  }



  // Normalizar: no asignamos consumo negativo (devoluciones) en esta etapa.
  for (const k of Object.keys(soldNeedByKey)){
    if (Number(soldNeedByKey[k]) < 0) soldNeedByKey[k] = 0;
  }

  if (!hasLotEvidence){
    const unassignedByKey = {};
    let unassignedTotal = 0;
    for (const [k, v] of Object.entries(soldNeedByKey)){
      const n = Math.max(0, Number(v) || 0);
      if (!(n > 0)) continue;
      unassignedByKey[k] = n;
      unassignedTotal += n;
    }
    return {
      eventId: evId,
      updatedAt,
      soldTotal: unassignedTotal,
      remainingTotal: 0,
      lots: {},
      unassigned: { byKey: unassignedByKey, total: unassignedTotal },
      keys: Object.keys(unassignedByKey),
      evidenceLotIds: [],
      evidenceLotCodes: []
    };
  }

  // 1) Construir cargas de lotes por grupo (FIFO por time)
  const groups = new Map();
  const ensureGroup = (e) => {
    const gKey = lotFifoGroupKeyFromInvEntryPOS(e);
    if (!gKey) return null;
    let g = groups.get(gKey);
    if (!g){
      g = {
        groupKey: gKey,
        loteCargaId: (e && e.loteCargaId != null) ? String(e.loteCargaId) : null,
        loteId: (e && e.loteId != null) ? e.loteId : null,
        loteCodigo: (e && e.loteCodigo != null) ? String(e.loteCodigo) : '',
        time: (e && e.time) ? String(e.time) : '',
        orderTs: NaN,
        orderId: NaN,
        byPid: new Map(),
      };
      groups.set(gKey, g);
    }
    // meta: preferimos valores no vacíos
    if (!g.loteCargaId && e && e.loteCargaId != null && String(e.loteCargaId).trim() !== '') g.loteCargaId = String(e.loteCargaId);
    if (g.loteId == null && e && e.loteId != null) g.loteId = e.loteId;
    if ((!g.loteCodigo || g.loteCodigo === '—') && e && e.loteCodigo) g.loteCodigo = String(e.loteCodigo);
    if ((!g.time || g.time === '') && e && e.time) g.time = String(e.time);

    const ts = lotFifoTsPOS(e && e.time);
    if (Number.isFinite(ts)){
      if (!Number.isFinite(g.orderTs) || ts < g.orderTs) g.orderTs = ts;
    }
    const rid = (e && e.id != null) ? Number(e.id) : NaN;
    if (Number.isFinite(rid)){
      if (!Number.isFinite(g.orderId) || rid < g.orderId) g.orderId = rid;
    }
    return g;
  };

  // restocks (entrada)
  for (const r of restocks){
    try{
      const lid = (r && r.loteId != null) ? String(r.loteId).trim() : '';
      if (lid) evidence.lotIds.add(lid);
      const cod = (r && r.loteCodigo != null) ? String(r.loteCodigo).trim() : '';
      if (cod) evidence.lotCodes.add(cod);
    }catch(_){ }
    const g = ensureGroup(r);
    if (!g) continue;
    const pid = Number(r.productId);
    const qty = Number(r.qty) || 0;
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (!qty) continue;
    g.byPid.set(pid, (Number(g.byPid.get(pid)) || 0) + qty);
  }

  // ajustes vinculados a lote (reversos): afectan la disponibilidad neta por lote
  const adj = inv.filter(e => e && e.type === 'adjust' && (e.source === 'lote_reverso' || e.loteCargaId != null || e.loteGroupKey != null));
  for (const a of adj){
    try{
      const lid = (a && a.loteId != null) ? String(a.loteId).trim() : '';
      if (lid) evidence.lotIds.add(lid);
      const cod = (a && a.loteCodigo != null) ? String(a.loteCodigo).trim() : '';
      if (cod) evidence.lotCodes.add(cod);
    }catch(_){ }
    const gKey = lotFifoGroupKeyFromInvEntryPOS(a);
    if (!gKey || !groups.has(gKey)) continue;
    const g = groups.get(gKey);
    const pid = Number(a.productId);
    const qty = Number(a.qty) || 0;
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (!qty) continue;
    g.byPid.set(pid, (Number(g.byPid.get(pid)) || 0) + qty);
  }

  // 2) Normalizar cada grupo → loadedByKey (clamp >=0)
  const loads = Array.from(groups.values()).map(g => {
    const loadedByKey = {};
    let loadedTotal = 0;
    for (const [pid, rawQty] of g.byPid.entries()){
      const qty = Number(rawQty) || 0;
      if (!(qty > 0)) continue;
      const prod = pMap.get(Number(pid)) || null;
      const key = lotFifoKeyFromProductPOS(prod, pid, (prod && prod.name) ? prod.name : '');
      if (!key) continue;
      loadedByKey[key] = (Number(loadedByKey[key]) || 0) + qty;
      loadedTotal += qty;
    }
    // Clamps por seguridad si hubo reversos mayores a la carga (no permitir negativo)
    for (const k of Object.keys(loadedByKey)){
      if (Number(loadedByKey[k]) < 0) loadedByKey[k] = 0;
    }
    return {
      ...g,
      loadedByKey,
      loadedTotal,
      // Fallbacks para ordenar si falta time
      orderTs: Number.isFinite(g.orderTs) ? g.orderTs : (Number.isFinite(g.orderId) ? g.orderId : 0),
      orderId: Number.isFinite(g.orderId) ? g.orderId : 0,
    };
  }).filter(g => g && g.loadedTotal > 0);

  // Orden FIFO = más viejo primero
  loads.sort((a,b)=> (a.orderTs - b.orderTs) || (a.orderId - b.orderId));

  // 3) Preparar salida por lote
  const outLots = {};
  const usedKeys = new Set();

  const lotKeyCounts = new Map();
  const mkLotKey = (g) => {
    const base = (g.loteId != null && String(g.loteId).trim() !== '')
      ? String(g.loteId)
      : ((g.loteCodigo || '').toString().trim() || String(g.groupKey));
    const prev = Number(lotKeyCounts.get(base)) || 0;
    lotKeyCounts.set(base, prev + 1);
    // Si se repite el mismo "base" en data rara, desambiguamos con groupKey (sin romper el caso normal)
    return (prev === 0) ? base : (base + '|' + String(g.groupKey));
  };

  const lotOrder = [];
  for (const g of loads){
    const lotKey = mkLotKey(g);
    lotOrder.push(lotKey);
    for (const k of Object.keys(g.loadedByKey || {})) usedKeys.add(k);
    outLots[lotKey] = {
      loteId: (g.loteId != null ? g.loteId : null),
      loteCodigo: (g.loteCodigo || ''),
      loteCargaId: (g.loteCargaId || null),
      loadedAt: (g.time || ''),
      soldByKey: {},
      remainingByKey: {},
      soldTotal: 0,
      remainingTotal: 0,
      // debug útil para etapas siguientes
      loadedByKey: {...(g.loadedByKey || {})}
    };
  }

  // Incluir también keys de ventas aunque no tengan lotes (quedan como unassigned)
  for (const k of Object.keys(soldNeedByKey)) usedKeys.add(k);

  const keys = Array.from(usedKeys);

  // 4) FIFO por cada key
  const unassignedByKey = {};
  for (const k of keys){
    let need = Math.max(0, Number(soldNeedByKey[k]) || 0);
    if (!(need > 0)){
      // llenar remaining sin tocar sold
      for (const lotKey of lotOrder){
        const lot = outLots[lotKey];
        const loaded = Number(lot.loadedByKey && lot.loadedByKey[k]) || 0;
        if (!Object.prototype.hasOwnProperty.call(lot.remainingByKey, k)){
          lot.remainingByKey[k] = Math.max(0, loaded);
        }
      }
      continue;
    }

    for (const lotKey of lotOrder){
      if (!(need > 0)) break;
      const lot = outLots[lotKey];
      const loaded = Number(lot.loadedByKey && lot.loadedByKey[k]) || 0;
      const alreadySold = Number(lot.soldByKey && lot.soldByKey[k]) || 0;
      const remainingHere = Math.max(0, loaded - alreadySold);
      if (!(remainingHere > 0)) continue;
      const take = Math.min(remainingHere, need);
      lot.soldByKey[k] = alreadySold + take;
      need -= take;
    }

    if (need > 0){
      unassignedByKey[k] = (Number(unassignedByKey[k]) || 0) + need;
    }

    // completar remainingByKey para este key
    for (const lotKey of lotOrder){
      const lot = outLots[lotKey];
      const loaded = Number(lot.loadedByKey && lot.loadedByKey[k]) || 0;
      const sold = Number(lot.soldByKey && lot.soldByKey[k]) || 0;
      lot.remainingByKey[k] = Math.max(0, loaded - sold);
    }
  }

  // 5) Totales por lote
  for (const lotKey of lotOrder){
    const lot = outLots[lotKey];
    let sTot = 0;
    let rTot = 0;
    for (const k of keys){
      sTot += Math.max(0, Number(lot.soldByKey && lot.soldByKey[k]) || 0);
      rTot += Math.max(0, Number(lot.remainingByKey && lot.remainingByKey[k]) || 0);
    }
    lot.soldTotal = sTot;
    lot.remainingTotal = rTot;
  }

  let unassignedTotal = 0;
  for (const v of Object.values(unassignedByKey)) unassignedTotal += Math.max(0, Number(v) || 0);

  let soldTotal = 0;
  let remainingTotal = 0;
  for (const lotKey of lotOrder){
    const lot = outLots[lotKey];
    soldTotal += Math.max(0, Number(lot && lot.soldTotal) || 0);
    remainingTotal += Math.max(0, Number(lot && lot.remainingTotal) || 0);
  }

  return {
    eventId: evId,
    updatedAt,
    soldTotal,
    remainingTotal,
    lots: outLots,
    lotOrder,
    keys,
    unassigned: { byKey: unassignedByKey, total: unassignedTotal },
    evidenceLotIds: Array.from(evidence.lotIds),
    evidenceLotCodes: Array.from(evidence.lotCodes)
  };
}

// Exponer canónicamente (para etapas siguientes / debug)
try{ window.computeLotFifoForEvent = computeLotFifoForEvent; }catch(_){ }

// ==============================
// Lotes FIFO (Etapa 2: persistencia de snapshot por evento)
// ==============================
const __A33_LOTS_USAGE_SYNC = { inFlight: new Map() };

function isPlainObjPOS(o){ return !!o && typeof o === 'object' && !Array.isArray(o); }
function safeNumPOS(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function normLotCodePOS(v){ return String(v || '').trim().toLowerCase(); }

function cloneNumMapPOS(obj){
  const out = {};
  if (!isPlainObjPOS(obj)) return out;
  for (const k of Object.keys(obj)){
    const n = safeNumPOS(obj[k]);
    if (n < 0) continue;
    out[k] = n;
  }
  return out;
}

function normalizeUsageSnapshotPOS(raw, stamp){
  const soldByKey = cloneNumMapPOS(raw && raw.soldByKey);
  const remainingByKey = cloneNumMapPOS(raw && raw.remainingByKey);
  let soldTotal = safeNumPOS(raw && raw.soldTotal);
  let remainingTotal = safeNumPOS(raw && raw.remainingTotal);
  if (soldTotal < 0) soldTotal = 0;
  if (remainingTotal < 0) remainingTotal = 0;
  return {
    updatedAt: (stamp != null ? stamp : Date.now()),
    soldByKey,
    remainingByKey,
    soldTotal,
    remainingTotal
  };
}

function upsertLotEventUsagePOS(lote, eventId, snap){
  if (!lote || eventId == null) return false;
  const eid = String(eventId);
  const eu = isPlainObjPOS(lote.eventUsage) ? lote.eventUsage : {};
  eu[eid] = snap;
  lote.eventUsage = eu;
  return true;
}

async function syncLotsUsageForEvent(eventId){
  const evId = Number(eventId);
  if (!Number.isFinite(evId) || evId <= 0) return { ok:false, reason:'eventId inválido' };

  const lotes = readLotesLS_POS();
  if (!Array.isArray(lotes) || !lotes.length) return { ok:true, updated:0, eventId: evId };

  const fifo = await computeLotFifoForEvent(evId);
  // Etapa 4: Integridad post-operación (números finitos/no negativos)
  const vInt = validateLotFifoIntegrityPOS(fifo, evId);
  if (!vInt.ok){
    return { ok:false, updated:0, eventId: evId, reason: vInt.msg || 'FIFO/Lotes inválido' };
  }
  const stamp = (fifo && fifo.updatedAt != null) ? fifo.updatedAt : Date.now();
  const lotsMap = (fifo && fifo.lots && typeof fifo.lots === 'object') ? fifo.lots : {};
  const evidenceIds = Array.isArray(fifo && fifo.evidenceLotIds) ? fifo.evidenceLotIds.map(x=>String(x)) : [];
  const evidenceCodes = Array.isArray(fifo && fifo.evidenceLotCodes) ? fifo.evidenceLotCodes.map(x=>String(x)) : [];

  const byId = new Map();
  const byCode = new Map();
  for (const l of lotes){
    if (!l) continue;
    const id = (l.id != null) ? String(l.id) : '';
    if (id) byId.set(id, l);
    const codeKey = normLotCodePOS(l.codigo || '');
    if (codeKey){
      const arr = byCode.get(codeKey) || [];
      arr.push(l);
      byCode.set(codeKey, arr);
    }
  }

  let updated = 0;
  const touched = new Set();

  const applySnap = (lotObj, rawSnapOrNull) => {
    if (!lotObj) return;
    const snap = rawSnapOrNull
      ? normalizeUsageSnapshotPOS(rawSnapOrNull, stamp)
      : normalizeUsageSnapshotPOS({ soldByKey:{}, remainingByKey:{}, soldTotal:0, remainingTotal:0 }, stamp);
    if (upsertLotEventUsagePOS(lotObj, evId, snap)){
      updated += 1;
      if (lotObj.id != null) touched.add(String(lotObj.id));
    }
  };

  // 1) Aplicar resultados calculados
  for (const k of Object.keys(lotsMap)){
    const s = lotsMap[k];
    if (!s) continue;
    const lid = (s.loteId != null && String(s.loteId).trim() !== '') ? String(s.loteId) : '';
    const codeKey = normLotCodePOS(s.loteCodigo || '');

    let lotObj = lid ? byId.get(lid) : null;
    if (!lotObj && codeKey){
      const arr = byCode.get(codeKey) || [];
      // Preferir lote asignado a este evento. Para evitar cruces por códigos repetidos,
      // solo hacemos fallback a un único candidato o a lotes sin asignación explícita.
      lotObj = arr.find(x => Number(x && x.assignedEventId) === evId) || null;
      if (!lotObj){
        const unassigned = arr.find(x => !(Number(x && x.assignedEventId) > 0));
        if (unassigned) lotObj = unassigned;
        else if (arr.length === 1) lotObj = arr[0];
      }
    }
    if (lotObj) applySnap(lotObj, s);
  }

  // 2) Canonizar a 0 lotes con evidencia pero sin grupo (ej. reverso completo)
  for (const lid of evidenceIds){
    if (!lid || touched.has(lid)) continue;
    const lotObj = byId.get(lid);
    if (lotObj) applySnap(lotObj, null);
  }
  for (const codeRaw of evidenceCodes){
    const codeKey = normLotCodePOS(codeRaw);
    if (!codeKey) continue;
    const arrAll = byCode.get(codeKey) || [];
    let arr = arrAll.filter(x => Number(x && x.assignedEventId) === evId);
    if (!arr.length) arr = arrAll.filter(x => !(Number(x && x.assignedEventId) > 0));
    if (!arr.length && arrAll.length === 1) arr = arrAll;
    for (const lotObj of arr){
      const lid = (lotObj && lotObj.id != null) ? String(lotObj.id) : '';
      if (lid && touched.has(lid)) continue;
      applySnap(lotObj, null);
    }
  }

  const ok = writeLotesLS_POS(lotes);
  return { ok, updated, eventId: evId };
}

function queueLotsUsageSyncPOS(eventId){
  const evId = Number(eventId);
  if (!Number.isFinite(evId) || evId <= 0) return Promise.resolve({ ok:false, reason:'eventId inválido' });
  const key = String(evId);

  if (__A33_LOTS_USAGE_SYNC.inFlight.has(key)) return __A33_LOTS_USAGE_SYNC.inFlight.get(key);

  const p = (async()=>{
    try{
      return await syncLotsUsageForEvent(evId);
    }catch(e){
      console.warn('syncLotsUsageForEvent failed', e);
      return { ok:false, reason:'error', eventId: evId, error: (e && e.message) ? e.message : String(e) };
    }finally{
      __A33_LOTS_USAGE_SYNC.inFlight.delete(key);
    }
  })();

  __A33_LOTS_USAGE_SYNC.inFlight.set(key, p);
  return p;
}

// Exponer canónicamente (para etapas siguientes / debug)
try{ window.syncLotsUsageForEvent = syncLotsUsageForEvent; }catch(_){ }


// --- Compatibilidad histórica: registros legacy de vasos ---
const ML_PER_GALON = 3750;

function safeInt(val, def){
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

function sanitizeFractionBatches(raw){
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(b=>{
    const y = safeInt(b && b.yieldCupsPerGallon, 22);
    const gallons = safeInt(b && b.gallons, 0);
    const mlPerCup = (b && typeof b.mlPerCup === 'number' && isFinite(b.mlPerCup) && b.mlPerCup > 0)
      ? b.mlPerCup
      : (ML_PER_GALON / Math.max(1, y));
    const cupsCreated = safeInt(b && b.cupsCreated, gallons * y);
    const cupsRemaining = safeInt(b && b.cupsRemaining, cupsCreated);
    return {
      batchId: (b && b.batchId ? String(b.batchId) : '') || ('fb-' + Math.random().toString(36).slice(2)),
      timestamp: (b && b.timestamp ? String(b.timestamp) : new Date().toISOString()),
      gallons,
      yieldCupsPerGallon: y,
      cupsCreated,
      cupsRemaining,
      mlPerCup,
      note: (b && b.note ? String(b.note) : '')
    };
  });
}

function isCupSaleRecord(sale){
  if (!sale) return false;
  if (sale.vaso === true) return true;
  if (Array.isArray(sale.fifoBreakdown) && sale.fifoBreakdown.length) return true;
  return false;
}

function isLegacyCupCostFallbackSalePOS(sale){
  if (!isCupSaleRecord(sale)) return false;
  // Los Vasos nuevos son productos POS normales con productId/costo propio.
  // Solo estimamos desde Galón para registros legacy sin productId y con evidencia antigua de fraccionamiento.
  return saleProductIdForInventoryPOS(sale) == null;
}

async function getEventByIdPOS(eventId){
  const evs = await getAll('events');
  return evs.find(e => e.id === eventId) || null;
}

async function revertCupConsumptionFromSalePOS(sale){
  if (!sale || !isCupSaleRecord(sale)) return;

  const evId = sale.eventId;
  if (!evId) return;

  const ev = await getEventByIdPOS(evId);
  if (!ev) return;

  const batches = sanitizeFractionBatches(ev.fractionBatches);

  const qAbs = Math.abs(Number(sale.qty || 0)) || 0;
  const breakdown = Array.isArray(sale.fifoBreakdown) ? sale.fifoBreakdown : [];

  if (breakdown.length){
    for (const item of breakdown){
      const bid = (item.batchId || '').toString();
      const taken = safeInt(item.cupsTaken, 0);
      if (!bid || !taken) continue;

      const b = batches.find(x => String(x.batchId) === bid);
      if (b){
        b.cupsRemaining = safeInt(b.cupsRemaining, 0) + taken;
      } else {
        const mlPerCup = (typeof item.mlPerCup === 'number' && isFinite(item.mlPerCup) && item.mlPerCup > 0)
          ? item.mlPerCup
          : (ML_PER_GALON / 22);
        const yieldGuess = Math.max(1, Math.round(ML_PER_GALON / mlPerCup));
        batches.push({
          batchId: 'adj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
          timestamp: new Date().toISOString(),
          gallons: 0,
          yieldCupsPerGallon: yieldGuess,
          cupsCreated: 0,
          cupsRemaining: taken,
          mlPerCup,
          note: 'Ajuste por eliminación (batch faltante)'
        });
      }
    }
  } else if (qAbs) {
    const oldest = batches.sort((a,b)=> (a.timestamp||'').localeCompare(b.timestamp||''))[0];
    if (oldest){
      oldest.cupsRemaining = safeInt(oldest.cupsRemaining, 0) + qAbs;
    } else {
      batches.push({
        batchId: 'adj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
        timestamp: new Date().toISOString(),
        gallons: 0,
        yieldCupsPerGallon: 22,
        cupsCreated: 0,
        cupsRemaining: qAbs,
        mlPerCup: ML_PER_GALON / 22,
        note: 'Ajuste por eliminación (sin batches)'
      });
    }
  }

  ev.fractionBatches = batches;
  await put('events', ev);
}


// Importar inventario desde Control de Lotes
	// Inventario (POS): Modal "Seleccionar lote" — Etapa 1 (solo lectura)
	function normalizeLoteNotesPOS(notas){
	  if (notas == null) return '';
	  if (Array.isArray(notas)){
	    return notas.map(x=>String(x ?? '').trim()).filter(Boolean).join(' | ');
	  }
	  return String(notas);
	}
	function formatLoteDatePOS(createdAt){
	  const s = (createdAt != null) ? String(createdAt) : '';
	  if (!s) return '';
	  // ISO común: YYYY-MM-DDTHH:mm:ssZ
	  if (s.length >= 10) return s.slice(0,10);
	  return s;
	}
	function loteCreatedTsPOS(l){
	  try{
	    if (!l) return 0;
	    const v = (l.createdAt != null) ? l.createdAt : (l.created_at != null ? l.created_at : (l.created || null));
	    if (v == null) return 0;
	    if (typeof v === 'number' && isFinite(v)) return intSafePOS(v);
	    const s = String(v).trim();
	    if (!s) return 0;
	    // epoch como string
	    if (/^\d{10,13}$/.test(s)) return intSafePOS(s);
	    const t = Date.parse(s);
	    return isFinite(t) ? t : 0;
	  }catch(_){ return 0; }
	}
	function intSafePOS(x){
	  try{ const n = parseInt(String(x),10); return isFinite(n) ? n : 0; }catch(_){ return 0; }
	}

	// Etapa 3: Estado EXACTO (compacto) — sin textos extra
	function loteIsClosedPOS_UI(l){
	  if (!l) return false;
	  const st = String(l?.status ?? '').trim().toUpperCase();
	  if (st && (st.includes('CERR') || st === 'CERRADO' || st === 'CLOSED')) return true;
	  if (l && (l.closedAt || l.closed_at || l.closed)) return true;
	  return false;
	}
	function computeLoteEstadoPOS_UI(l){
	  if (!l) return 'Disponible';
	  // D) Cerrado
	  if (loteIsClosedPOS_UI(l)) return 'Cerrado';
	  // A) Asignado a evento
	  const assignedId = (l && l.assignedEventId != null) ? String(l.assignedEventId).trim() : '';
	  const assignedNm = String(l?.assignedEventName ?? '').trim();
	  if (assignedId || assignedNm){
	    return assignedNm || (assignedId ? ('#' + assignedId) : '');
	  }
	  // B) Lote hijo / sobrante (NO asignado)
	  const lt = String(l?.loteType ?? '').trim().toUpperCase();
	  const parentId = (l && l.parentLotId != null) ? String(l.parentLotId).trim() : '';
	  const isChild = (lt === 'SOBRANTE') || !!parentId;
	  if (isChild){
	    const src = String(l?.sourceEventName ?? '').trim();
	    return src || 'Desconocido';
	  }
	  // C) Disponible
	  return 'Disponible';
	}

	function loteHasAssignedPOS(l){
	  const id = (l && l.assignedEventId != null) ? String(l.assignedEventId).trim() : '';
	  const nm = (l && l.assignedEventName != null) ? String(l.assignedEventName).trim() : '';
	  return !!id || !!nm;
	}
	function loteIsUsablePOS(l){
	  if (!l) return false;
	  if (loteHasAssignedPOS(l)) return false;
	  const raw = String(l.status || '').trim();
	  if (!raw) return true; // lote viejo equivalente
	  const st = normLoteStatusPOS(l.status);
	  if (!st) return false; // status desconocido explícito
	  return st === 'DISPONIBLE';
	}

	// Lectura FRESCA de arcano33_lotes (sin cachear en memoria)
	function readAllLotesFromSharedPOS(){
	  try{
	    // 1) Directo a localStorage (más fresco posible)
	    try{
	      if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function'){
	        const rawLS = localStorage.getItem('arcano33_lotes');
	        if (rawLS != null){
	          const parsedLS = JSON.parse(rawLS);
	          return Array.isArray(parsedLS) ? parsedLS : [];
	        }
	      }
	    }catch(_){ /* fallback */ }

	    // 2) Wrapper A33Storage (multi-tab)
	    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
	      const arr = A33Storage.sharedGet('arcano33_lotes', [], 'local');
	      return Array.isArray(arr) ? arr : [];
	    }
	    if (window.A33Storage && typeof A33Storage.getJSON === 'function'){
	      const arr = A33Storage.getJSON('arcano33_lotes', []);
	      return Array.isArray(arr) ? arr : [];
	    }
	    if (window.A33Storage && typeof A33Storage.getItem === 'function'){
	      const raw = A33Storage.getItem('arcano33_lotes');
	      if (!raw) return [];
	      const parsed = JSON.parse(raw);
	      return Array.isArray(parsed) ? parsed : [];
	    }
	    return [];
	  }catch(_){
	    return null;
	  }
	}

	async function renderInvLoteSelectorTablePOS(evId, opts){
	  const options = opts || {};
	  const tbody = document.querySelector('#inv-lote-selector-table tbody');
	  const msgEl = document.getElementById('inv-lote-selector-msg');
	  if (!tbody) return;
	  tbody.innerHTML = '';

	  const query = (options.query != null) ? String(options.query) : '';
	  const q = query.toLowerCase().trim();
	  const fresh = !!options.fresh;
	  const useCache = !!options.useCache;

	  // Cache liviano para que el filtro sea instantáneo (se invalida con refresh/fresh)
	  if (!window.__INV_LOTE_SELECTOR_CACHE) window.__INV_LOTE_SELECTOR_CACHE = null;
	  let lotes = null;
	  if (!fresh && useCache && Array.isArray(window.__INV_LOTE_SELECTOR_CACHE))
	    lotes = window.__INV_LOTE_SELECTOR_CACHE;
	  else
	    lotes = readAllLotesFromSharedPOS();

	  if (lotes === null){
	    if (msgEl) msgEl.textContent = '';
	    const tr = document.createElement('tr');
	    tr.innerHTML = '<td colspan="5" class="muted">No se pudo leer arcano33_lotes.</td>';
	    tbody.appendChild(tr);
	    return;
	  }
	  window.__INV_LOTE_SELECTOR_CACHE = Array.isArray(lotes) ? lotes : [];
	  const base = Array.isArray(lotes) ? lotes.slice() : [];
	  if (!base.length){
	    if (msgEl) msgEl.textContent = '';
	    const tr = document.createElement('tr');
	    tr.innerHTML = '<td colspan="5" class="muted">No hay lotes.</td>';
	    tbody.appendChild(tr);
	    return;
	  }

	  // Orden: más recientes primero (createdAt desc), con fallback seguro
	  base.sort((a,b)=>{
	    const ta = loteCreatedTsPOS(a);
	    const tb = loteCreatedTsPOS(b);
	    if (tb !== ta) return tb - ta;
	    const ca = String(a?.codigo ?? '');
	    const cb = String(b?.codigo ?? '');
	    if (cb !== ca) return cb.localeCompare(ca);
	    const ia = String(a?.id ?? '');
	    const ib = String(b?.id ?? '');
	    return ib.localeCompare(ia);
	  });

	  // Filtro rápido: código / notas (case-insensitive)
	  let view = base;
	  if (q){
	    view = base.filter(l=>{
	      const code = String(l?.codigo ?? '').toLowerCase();
	      const notes = normalizeLoteNotesPOS(l?.notas).toLowerCase();
	      return code.includes(q) || notes.includes(q);
	    });
	  }

	  const usableView = view.reduce((acc,l)=> acc + (loteIsUsablePOS(l) ? 1 : 0), 0);

	  // Mensajería clara
	  if (msgEl){
	    let msg = '';
	    if (!evId) msg = 'Selecciona un evento para poder usar un lote.';
	    // "No hay lotes disponibles" solo aplica como estado vacío.
	    // Si hay filas, NO se muestra este mensaje (aunque estén deshabilitadas).
	    else if (!view.length) msg = 'No hay lotes disponibles.';
	    if (q){
	      msg = (msg ? (msg + ' ') : '') + ('Mostrando ' + view.length + ' de ' + base.length + '.');
	    }
	    msgEl.textContent = msg;
	  }

	  if (!view.length){
	    const tr = document.createElement('tr');
	    tr.innerHTML = '<td colspan="5" class="muted">No hay lotes.</td>';
	    tbody.appendChild(tr);
	    return;
	  }

	  for (const l of view){
	    const codigo = String(l?.codigo ?? '').trim();
	    const fecha = formatLoteDatePOS(l?.createdAt);
	    const nota = normalizeLoteNotesPOS(l?.notas);
	    const estado = computeLoteEstadoPOS_UI(l);

	    const tr = document.createElement('tr');
	    const td1 = document.createElement('td'); td1.textContent = codigo;
	    const td2 = document.createElement('td'); td2.textContent = fecha;
	    const td3 = document.createElement('td');
	    // Notas: wrap + altura controlada + ver más
	    const wrap = document.createElement('div');
	    wrap.className = 'note-wrap';
	    const clamp = document.createElement('div');
	    clamp.className = 'note-clamp';
	    clamp.textContent = String(nota ?? '');
	    wrap.appendChild(clamp);
	    td3.appendChild(wrap);

	    const td4 = document.createElement('td'); td4.textContent = estado;
	    const td5 = document.createElement('td');
	    const btn = document.createElement('button');
	    btn.className = 'btn-outline btn-pill btn-pill-mini';
	    btn.type = 'button';
	    btn.textContent = 'Usar';
	    const canUse = !!evId && loteIsUsablePOS(l);
	    btn.disabled = !canUse;
	    if (!evId) btn.title = 'Selecciona un evento para poder usar un lote.';
	    else if (!canUse) btn.title = 'Este lote no está disponible.';
	    if (canUse){
	      btn.addEventListener('click', ()=>{ handleUseLoteFromSelectorPOS(btn, l); });
	    }
	    td5.appendChild(btn);

	    tr.appendChild(td1);
	    tr.appendChild(td2);
	    tr.appendChild(td3);
	    tr.appendChild(td4);
	    tr.appendChild(td5);
	    tbody.appendChild(tr);
	  }
	}
	function setupInvLoteSelectorModalPOS(){
	  const modalId = 'inv-lote-selector-modal';
	  const modal = document.getElementById(modalId);
	  const btnClose = document.getElementById('inv-lote-selector-close');
	  const btnRefresh = document.getElementById('inv-lote-selector-refresh');
	  if (btnClose){
	    btnClose.onclick = ()=>{ try{ closeModalPOS(modalId); }catch(_){ } };
	  }
	  if (btnRefresh){
	    btnRefresh.onclick = async ()=>{
	      try{
	        const evSel = document.getElementById('inv-event');
	        const evId = (evSel && evSel.value) ? parseInt(evSel.value,10) : null;
	        const qEl = document.getElementById('inv-lote-selector-search');
	        const q = qEl ? qEl.value : '';
	        await renderInvLoteSelectorTablePOS(evId, { query: q, fresh: true });
	      }catch(_){ }
	    };
	  }
	  // Filtro rápido (Etapa 4)
	  const inpSearch = document.getElementById('inv-lote-selector-search');
	  const btnClear = document.getElementById('inv-lote-selector-clear');
	  let tSearch = null;
	  const runSearch = async (fresh=false)=>{
	    try{
	      const evSel = document.getElementById('inv-event');
	      const evId = (evSel && evSel.value) ? parseInt(evSel.value,10) : null;
	      const q = inpSearch ? inpSearch.value : '';
	      await renderInvLoteSelectorTablePOS(evId, { query: q, fresh: !!fresh, useCache: !fresh });
	    }catch(_){ }
	  };
	  if (inpSearch){
	    inpSearch.addEventListener('input', ()=>{
	      try{ if (tSearch) clearTimeout(tSearch); }catch(_){ }
	      tSearch = setTimeout(()=>{ runSearch(false); }, 80);
	    });
	  }
	  if (btnClear){
	    btnClear.onclick = ()=>{
	      try{ if (inpSearch) inpSearch.value = ''; }catch(_){ }
	      runSearch(false);
	      try{ if (inpSearch) inpSearch.focus(); }catch(_){ }
	    };
	  }

	  if (modal){
	    modal.addEventListener('click', (e)=>{
	      try{ if (e && e.target === modal) closeModalPOS(modalId); }catch(_){ }
	    });
	  }
	  // Escape cierra solo si está abierto
	  try{
	    document.addEventListener('keydown', (e)=>{
	      if (!e || e.key !== 'Escape') return;
	      const m = document.getElementById(modalId);
	      if (m && m.style && m.style.display === 'flex'){
	        try{ e.preventDefault(); }catch(_){ }
	        try{ closeModalPOS(modalId); }catch(_){ }
	      }
	    }, true);
	  }catch(_){ }
	}
	let __INV_LOTE_USE_BUSY = false;
	async function openInvLoteSelectorModalPOS(){
	  const modalId = 'inv-lote-selector-modal';
	  const modal = document.getElementById(modalId);
	  const tbody = document.querySelector('#inv-lote-selector-table tbody');
	  if (!modal || !tbody){
	    alert('No se pudo abrir el selector de lotes (UI incompleta).');
	    return;
	  }
	  const evSel = document.getElementById('inv-event');
	  const evId = (evSel && evSel.value) ? parseInt(evSel.value,10) : null;
	  const qEl = document.getElementById('inv-lote-selector-search');
	  const q = qEl ? qEl.value : '';

	  // Lectura fresca + render inicial
	  await renderInvLoteSelectorTablePOS(evId, { query: q, fresh: true });
	  openModalPOS(modalId);
	  if (!evId){
	    try{ showToast('Selecciona un evento para poder usar un lote.', 'info', 2200); }catch(_){ }
	  }
	  try{ if (qEl) qEl.focus(); }catch(_){ }
	}

	async function handleUseLoteFromSelectorPOS(btn, lote){
	  if (__INV_LOTE_USE_BUSY){
	    try{ showToast('Carga en curso…', 'info', 1500); }catch(_){ }
	    return;
	  }
	  const evSel = document.getElementById('inv-event');
	  const evId = (evSel && evSel.value) ? parseInt(evSel.value,10) : null;
	  if (!evId){
	    try{ showToast('Primero selecciona un evento.', 'error', 2600); }catch(_){ }
	    try{ if (btn) btn.disabled = true; }catch(_){ }
	    return;
	  }
	  // Revalidar disponibilidad (por si cambió mientras el modal está abierto)
	  if (!loteIsUsablePOS(lote)){
	    try{ showToast('Este lote ya no está disponible.', 'error', 2800); }catch(_){ }
	    try{ if (btn) btn.disabled = true; }catch(_){ }
	    return;
	  }
	  __INV_LOTE_USE_BUSY = true;
	  let ok = false;
	  try{
	    try{ setBtnSavingStatePOS(btn, true, 'Aplicando…'); }catch(_){ }
	    const res = await importFromLoteToInventory({
	      evId,
	      loteId: (lote && lote.id != null) ? lote.id : null,
	      loteCodigo: (lote && lote.codigo != null) ? lote.codigo : ''
	    });
	    ok = !!(res && res.ok);
	    if (ok){
	      // limpiar estado busy del botón
	      try{ setBtnSavingStatePOS(btn, false); }catch(_){ }
	      try{ if (btn) btn.disabled = true; }catch(_){ }
	      // Etapa 3: refrescar tabla (estado + botones) sin cache
	      try{ await renderInvLoteSelectorTablePOS(evId); }catch(_){ }
	    }
	  }catch(err){
	    try{ showPersistFailPOS('aplicar lote', err); }catch(_){ }
	  }finally{
	    __INV_LOTE_USE_BUSY = false;
	    if (!ok){
	      try{ setBtnSavingStatePOS(btn, false); }catch(_){ }
	      try{ if (btn) btn.disabled = false; }catch(_){ }
	    }
	  }
	}

async function importFromLoteToInventory(opts){
  const o = opts || {};
  const evSel = $('#inv-event');
  let evId = (o.evId != null && String(o.evId).trim() !== '') ? parseInt(o.evId,10) : (evSel && evSel.value ? parseInt(evSel.value,10) : null);
  if (!evId){
    try{ showToast('Primero selecciona un evento.', 'error', 2600); }catch(_){ }
    return { ok:false, reason:'NO_EVENT' };
  }

  // Lote objetivo
  const targetId = (o.loteId != null && String(o.loteId).trim() !== '') ? String(o.loteId) : '';
  const codigoNorm = (o.loteCodigo != null) ? String(o.loteCodigo).toLowerCase().trim() : '';
  if (!targetId && !codigoNorm){
    try{ openInvLoteSelectorModalPOS(); }catch(_){ }
    return { ok:false, reason:'NO_LOTE' };
  }

  // Evento real (para nombre)
  const ev = await getEventByIdPOS(evId);
  const evName = (ev && ev.name) ? String(ev.name) : '';

  let lotes = [];
  try {
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
      const arr = A33Storage.sharedGet('arcano33_lotes', [], 'local');
      lotes = Array.isArray(arr) ? arr : [];
    } else {
      const raw = A33Storage.getItem('arcano33_lotes');
      if (raw) lotes = JSON.parse(raw) || [];
      if (!Array.isArray(lotes)) lotes = [];
    }
  } catch (e) {
    try{ showToast('No se pudo leer la información de lotes.', 'error', 4200); }catch(_){ }
    return { ok:false, reason:'READ_FAIL' };
  }
  if (!lotes.length){
    try{ showToast('No hay lotes registrados en el Control de Lotes.', 'error', 3600); }catch(_){ }
    return { ok:false, reason:'NO_LOTES' };
  }

  const matchFn = (l) => {
    if (!l) return false;
    if (targetId && l.id != null && String(l.id) === targetId) return true;
    if (codigoNorm) return ((l.codigo || '').toString().toLowerCase().trim() === codigoNorm);
    return false;
  };

  const loteAny = lotes.find(matchFn);
  if (!loteAny){
    try{ showToast('No se encontró el lote seleccionado.', 'error', 3200); }catch(_){ }
    return { ok:false, reason:'NOT_FOUND' };
  }

  // Disponibilidad
  if (!loteIsUsablePOS(loteAny)){
    const prevEvName = (loteAny.assignedEventName || '').toString().trim();
    const msg = 'Ese lote no está disponible' + (prevEvName ? (' (ya fue asignado a "' + prevEvName + '")') : '') + '.';
    try{ showToast(msg, 'error', 4300); }catch(_){ }
    return { ok:false, reason:'NOT_AVAILABLE' };
  }

  const stamp = new Date().toISOString();
  const cargaId = 'lc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);

  const products = await getAll('products');
  const norm = s => (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  const items = [];
  let total = 0;

  const contractRows = lotesPOSContractRowsPOS(loteAny);
  if (contractRows.length){
    // Contrato dinámico Lotes → POS: Product ID manda y evita sumar dos veces legacy + dinámico.
    for (const row of contractRows){
      const qty = lotesPOSQtyFromContractRowPOS(row);
      if (!(qty > 0)) continue;
      const prod = resolveProductFromLoteContractRowPOS(row, products);
      if (!prod) continue;
      const unitCost = saleCostFromFieldsPOS(row) || saleCostFromFieldsPOS(loteAny);
      items.push({
        productId: prod.id,
        qty,
        unitCost,
        nombreSnapshot: row.nombreSnapshot || row.nombre || row.name || prod.name || '',
        loteProductId: row.productId ?? row.productoId ?? null,
        letra: row.Letra || row.letra || '',
        source: 'lotes_productId'
      });
      total += qty;
    }
  } else {
    const map = [
      { field: 'pulso', name: 'Pulso 250ml' },
      { field: 'media', name: 'Media 375ml' },
      { field: 'djeba', name: 'Djeba 750ml' },
      { field: 'litro', name: 'Litro 1000ml' },
      { field: 'galon', name: 'Galón 3720 ml' }
    ];

    for (const m of map){
      const rawQty = (loteAny[m.field] ?? '0').toString();
      const qty = parseInt(rawQty, 10);
      if (!(qty > 0)) continue;
      let prod = products.find(p => norm(p.name) === norm(m.name));
      // Compat Galón: permitir legacy 'Galón 3750 ml' y/o cualquier nombre que mapee a 'galon'
      if (!prod && m.field === 'galon') {
        prod = products.find(p => norm(p.name) === norm('Galón 3750 ml')) || products.find(p => mapProductNameToFinishedId(p.name) === 'galon') || null;
      }
      if (!prod) continue;
      items.push({ productId: prod.id, qty, unitCost: saleCostFromFieldsPOS(loteAny), source: 'lotes_legacy' });
      total += qty;
    }
  }
  if (!items.length){
    try{ showToast('Ese lote no trae unidades para cargar (todo está en 0).', 'error', 3800); }catch(_){ }
    return { ok:false, reason:'EMPTY' };
  }

  // Asignación única: marcamos el lote como EN_EVENTO y lo vinculamos al evento (anti stock fantasma)
  try {
    const idx = lotes.findIndex(l => (loteAny.id != null && l.id === loteAny.id) || matchFn(l));
    if (idx >= 0){
      const prev = lotes[idx] || {};
      const hist = Array.isArray(prev.assignmentHistory) ? prev.assignmentHistory.slice() : [];
      hist.push({
        type: 'ASSIGN',
        at: stamp,
        eventId: evId,
        eventName: evName || ('Evento #' + evId),
        loteCargaId: cargaId
      });
      lotes[idx] = {
        ...prev,
        status: 'EN_EVENTO',
        assignedEventId: evId,
        assignedEventName: evName || ('Evento #' + evId),
        assignedAt: stamp,
        assignedCargaId: cargaId,
        assignmentHistory: hist
      };
      if (window.A33Storage && typeof A33Storage.sharedSet === 'function'){
        const r = A33Storage.sharedSet('arcano33_lotes', lotes, { source: 'pos' });
        if (!r || !r.ok) throw new Error((r && r.message) ? r.message : 'No se pudo guardar lotes (conflicto).');
      } else {
        A33Storage.setItem('arcano33_lotes', JSON.stringify(lotes));
      }
    }
  } catch (e){
    try{ showToast('No se pudo marcar el lote como asignado. No se aplicó la carga.', 'error', 4200); }catch(_){ }
    return { ok:false, reason:'SAVE_FAIL' };
  }

  for (const it of items){
    await addRestock(evId, it.productId, it.qty, {
      source: 'lote',
      loteCodigo: (loteAny.codigo || ''),
      loteId: (loteAny.id != null ? loteAny.id : null),
      loteCargaId: cargaId,
      loteGroupKey: cargaId,
      loteProductId: it.loteProductId ?? null,
      loteLetra: it.letra || '',
      loteNombreSnapshot: it.nombreSnapshot || '',
      unitCost: it.unitCost > 0 ? round2(it.unitCost) : 0,
      costPerUnit: it.unitCost > 0 ? round2(it.unitCost) : 0,
      costoUnitario: it.unitCost > 0 ? round2(it.unitCost) : 0,
      sourceDetail: it.source || '',
      time: stamp,
      notes: 'Reposición (lote ' + (loteAny.codigo || '') + ')'
    });
  }

  await renderInventario();
  await refreshSaleStockLabel();
  try{ showToast('Lote aplicado: "' + (loteAny.codigo || '') + '" (' + total + ' u.)', 'ok', 2200); }catch(_){ }

  // FIFO (Etapa 2): snapshot por evento/lote (entrada de lote al evento)
  try{ queueLotsUsageSyncPOS(evId); }catch(_){ }

  return { ok:true, evId, loteCodigo: (loteAny.codigo || ''), total };
}


// Lotes cargados en este evento (solo informativo)
async function renderLotesCargadosEvento(eventId){
  const tbody = $('#tbl-lotes-evento tbody');
  const badge = $('#lotes-count');
  if (!tbody) return;

  tbody.innerHTML = '';

  const entries = await getInventoryEntries(eventId);
  const rows = (entries || [])
    .filter(e => e && e.type === 'restock' && (e.loteCodigo || e.source === 'lote'))
    .sort((a,b)=> (b.time||'').localeCompare(a.time||''));

  // Detectar reversos (ajustes negativos) por grupo de carga, para marcar la historia sin ocultarla
  const revRows = (entries || [])
    .filter(e => e && e.type === 'adjust' && e.source === 'lote_reverso');
  const revByGroupKey = new Map();
  for (const r of revRows){
    const k = (r.loteGroupKey || r.loteCargaId || '')
      ? String(r.loteGroupKey || r.loteCargaId)
      : '';
    if (!k) continue;
    const t = (r.time || '').toString();
    const prev = revByGroupKey.get(k);
    if (!prev || t.localeCompare(prev) > 0) revByGroupKey.set(k, t);
  }

  const prods = await getAll('products');
  const pMap = new Map((prods||[]).map(p => [p.id, p]));

  // Agrupar: 1 fila por cada "carga" de lote
  const groups = new Map();
  for (const it of rows){
    const loteCodigo = (it.loteCodigo || '').toString().trim();
    const time = (it.time || '').toString();
    const gKey = it.loteCargaId
      ? String(it.loteCargaId)
      : ((loteCodigo || '—') + '|' + (time || ''));
    let g = groups.get(gKey);
    if (!g){
      g = { loteCodigo: loteCodigo || '—', time: time || '', groupKey: gKey, P:0, M:0, D:0, L:0, G:0 };
      groups.set(gKey, g);
    }
    if ((g.loteCodigo === '—' || !g.loteCodigo) && loteCodigo) g.loteCodigo = loteCodigo;
    if (!g.time && time) g.time = time;

    const p = pMap.get(it.productId);
    const key = presKeyFromProductNamePOS(p ? (p.name || '') : '');
    const qty = Number(it.qty) || 0;
    if (key) g[key] = (Number(g[key]) || 0) + qty;

    // marcar si esta carga fue reversada (para claridad)
    if (!g.reversedAt && revByGroupKey.has(gKey)){
      g.reversedAt = revByGroupKey.get(gKey);
    }
  }

  const out = Array.from(groups.values()).sort((a,b)=> (b.time||'').localeCompare(a.time||''));
  if (badge) badge.textContent = String(out.length || 0);

  if (!out.length){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7"><small class="muted">No hay lotes cargados en este evento.</small></td>';
    tbody.appendChild(tr);
    return;
  }

  for (const g of out){
    const dt = g.time ? new Date(g.time).toLocaleString('es-NI') : '';
    const tr = document.createElement('tr');
    const codeTxt = escapeHtml((g.loteCodigo || '—').toString()) + (g.reversedAt ? ' ↩︎ REV' : '');
    tr.innerHTML = `
      <td>${codeTxt}</td>
      <td>${escapeHtml(dt || '')}</td>
      <td>${Number(g.P)||0}</td>
      <td>${Number(g.M)||0}</td>
      <td>${Number(g.D)||0}</td>
      <td>${Number(g.L)||0}</td>
      <td>${Number(g.G)||0}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ==============================
// Sobrantes → Lote hijo (Control de Lotes)
// - Crea un nuevo lote DISPONIBLE con parentLotId/sourceEventId
// - Marca el lote original como CERRADO (sin perder Evento asignado)
// ==============================
const LOTES_LS_KEY = 'arcano33_lotes';

function normLoteStatusPOS(status){
  const sRaw = String(status || '').trim().toUpperCase();
  if (!sRaw) return '';
  const s = (sRaw === 'EN EVENTO') ? 'EN_EVENTO' : sRaw;
  if (s === 'DISPONIBLE' || s === 'EN_EVENTO' || s === 'CERRADO') return s;
  return '';
}


function effectiveLoteStatusPOS(lote){
  const st = normLoteStatusPOS(lote && lote.status);
  if (st === 'CERRADO') return 'CERRADO';
  const assignedId = (lote && lote.assignedEventId != null) ? String(lote.assignedEventId).trim() : '';
  const assignedName = (lote && lote.assignedEventName != null) ? String(lote.assignedEventName).trim() : '';
  const hasAssigned = !!assignedId || !!assignedName;
  if (st) return st;
  return hasAssigned ? 'EN_EVENTO' : 'DISPONIBLE';
}


function readLotesLS_POS(){
  try{
    const LS = window.A33Storage;
    if (!LS) return [];
    if (typeof LS.sharedGet === 'function'){
      const arr = LS.sharedGet(LOTES_LS_KEY, [], 'local');
      return Array.isArray(arr) ? arr : [];
    }
    const arr = LS.getJSON(LOTES_LS_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }catch(_){
    return [];
  }
}

function writeLotesLS_POS(arr){
  try{
    const LS = window.A33Storage;
    if (!LS) return false;
    const safe = Array.isArray(arr) ? arr : [];
    if (typeof LS.sharedSet === 'function'){
      const r = LS.sharedSet(LOTES_LS_KEY, safe, { source: 'pos' });
      if (!r || !r.ok){
        try{ showToast((r && r.message) ? r.message : 'Conflicto al guardar lotes. Recarga e intenta de nuevo.', 'error', 4200); }catch(_){ }
        return false;
      }
      return true;
    }
    LS.setJSON(LOTES_LS_KEY, safe);
    return true;
  }catch(_){
    return false;
  }
}

function lotHasSobranteChildPOS(allLotes, parentId, eventId){
  if (!parentId) return false;
  const arr = Array.isArray(allLotes) ? allLotes : [];
  return arr.some(l => l && String(l.parentLotId||'') === String(parentId) && Number(l.sourceEventId||0) === Number(eventId||0));
}

function makeSobranteCodePOS(eventName){
  const base = String(eventName || 'Evento').trim() || 'Evento';
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth()+1).padStart(2,'0');
  const d = String(today.getDate()).padStart(2,'0');
  const rand = Math.random().toString(36).slice(2,5).toUpperCase();
  return `SOBRANTE — ${base} — ${y}-${m}-${d} — ${rand}`;
}

async function getPresentationProductIdMapPOS(){
  const prods = await getAll('products');
  const map = { P:null, M:null, D:null, L:null, G:null };
  for (const p of (prods || [])){
    const n = normName(p && p.name);
    if (!n) continue;
    if (!map.P && n.includes('pulso')) map.P = p.id;
    else if (!map.M && n.includes('media')) map.M = p.id;
    else if (!map.D && n.includes('djeba')) map.D = p.id;
    else if (!map.L && n.includes('litro')) map.L = p.id;
    else if (!map.G && (n.includes('galon') || n.includes('galón'))) map.G = p.id;
  }
  return map;
}

async function prefillSobranteQtySuggestPOS(eventId){
  const ids = await getPresentationProductIdMapPOS();
  const out = { P:0, M:0, D:0, L:0, G:0 };
  for (const k of Object.keys(out)){
    const pid = ids[k];
    if (pid == null) continue;
    try{
      const st = await computeStock(eventId, pid);
      const n = Number(st || 0);
      out[k] = n > 0 ? Math.floor(n) : 0;
    }catch(_){ }
  }
  return out;
}

function setSobranteInputsPOS(vals){
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = String(Math.max(0, Number(v || 0)) | 0); };
  set('sobrante-p', vals.P);
  set('sobrante-m', vals.M);
  set('sobrante-d', vals.D);
  set('sobrante-l', vals.L);
  set('sobrante-g', vals.G);
}

function getSobranteInputsPOS(){
  const get = (id) => {
    const el = document.getElementById(id);
    const n = parseInt(el && el.value ? el.value : '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return { P:get('sobrante-p'), M:get('sobrante-m'), D:get('sobrante-d'), L:get('sobrante-l'), G:get('sobrante-g') };
}


function updateSobranteMetaPOS(){
  const sel = document.getElementById('sobrante-lote-select');
  const meta = document.getElementById('sobrante-lote-meta');
  if (!sel || !meta) return;
  const parentId = sel.value ? String(sel.value) : '';
  if (!parentId){
    meta.textContent = '';
    return;
  }
  const allLotes = readLotesLS_POS();
  const parent = allLotes.find(l => l && String(l.id) === parentId) || null;
  const code = parent ? (parent.codigo || parent.name || parent.nombre || ('Lote ' + parentId)).toString() : ('Lote ' + parentId);
  meta.textContent = `Se cerrará el lote original: ${code}`;
}

async function refreshSobranteUIForEventPOS(eventId){
  const btn = document.getElementById('btn-create-sobrante');
  const panel = document.getElementById('sobrante-panel');
  const sel = document.getElementById('sobrante-lote-select');
  const meta = document.getElementById('sobrante-lote-meta');
  if (!btn || !panel || !sel) return;

  const allLotes = readLotesLS_POS();
  const candidates = allLotes.filter(l => {
    if (!l) return false;
    if (Number(l.assignedEventId || 0) !== Number(eventId || 0)) return false;
    const st = effectiveLoteStatusPOS(l);
    if (st !== 'EN_EVENTO') return false;
    // prevenir doble sobrante
    if (l.sobranteLotId) return false;
    if (lotHasSobranteChildPOS(allLotes, l.id, eventId)) return false;
    return true;
  });

  sel.innerHTML = '';
  if (!candidates.length){
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— No hay lotes EN_EVENTO sin sobrante —';
    sel.appendChild(opt);
    btn.disabled = true;
    if (meta) meta.textContent = 'Tip: si necesitas cargar más inventario, crea otro lote nuevo. Si hubo sobrantes, primero asegúrate de haber cargado el lote al evento.';
    // Si el panel estaba abierto y ya no hay candidatos, cerrarlo
    panel.style.display = 'none';
    return;
  }

  btn.disabled = false;
  for (const l of candidates){
    const opt = document.createElement('option');
    opt.value = String(l.id);
    const code = (l.codigo || l.name || l.nombre || ('Lote ' + l.id)).toString();
    opt.textContent = code;
    sel.appendChild(opt);
  }

  // meta del select + listener
  try{
    updateSobranteMetaPOS();
    sel.onchange = () => { try{ updateSobranteMetaPOS(); }catch(_){ } };
  }catch(_){ }
}

async function openSobrantePanelPOS(){
  const panel = document.getElementById('sobrante-panel');
  const btn = document.getElementById('btn-create-sobrante');
  if (!panel) return;

  const evId = parseInt((document.getElementById('inv-event') && document.getElementById('inv-event').value) || '0', 10);
  if (!evId) return alert('Selecciona un evento');

  // Validar evento (si está abierto, permitir pero advertir)
  const evs = await getAll('events');
  const ev = evs.find(e => e && Number(e.id) === Number(evId)) || null;
  if (!ev){ alert('Evento no encontrado'); return; }
  if (!ev.closedAt){
    const ok = confirm('Este evento aún está ABIERTO.\n\n¿Crear lote sobrante de todas formas? (Recomendado al final del evento)');
    if (!ok) return;
  }

  await refreshSobranteUIForEventPOS(evId);

  if (btn && btn.disabled){
    alert('No hay lotes EN_EVENTO disponibles para crear sobrante (o ya se creó el sobrante).');
    return;
  }

  // Sugerir cantidades basado en stock actual del evento
  try{
    const suggest = await prefillSobranteQtySuggestPOS(evId);
    setSobranteInputsPOS(suggest);
  }catch(e){
    setSobranteInputsPOS({P:0,M:0,D:0,L:0,G:0});
  }

  panel.style.display = 'block';
}

async function closeSobrantePanelPOS(){
  const panel = document.getElementById('sobrante-panel');
  if (panel) panel.style.display = 'none';
}

async function createSobranteLotPOS(){
  const evId = parseInt((document.getElementById('inv-event') && document.getElementById('inv-event').value) || '0', 10);
  if (!evId) return alert('Selecciona un evento');

  const sel = document.getElementById('sobrante-lote-select');
  const parentId = sel && sel.value ? sel.value : '';
  if (!parentId) return alert('Selecciona un lote original');

  const qty = getSobranteInputsPOS();
  const total = Number(qty.P||0)+Number(qty.M||0)+Number(qty.D||0)+Number(qty.L||0)+Number(qty.G||0);
  if (!(total > 0)) return alert('Ingresa al menos una cantidad sobrante (> 0).');

  const allLotes = readLotesLS_POS();
  const parent = allLotes.find(l => l && String(l.id) === String(parentId));
  if (!parent){
    alert('No se encontró el lote original en Control de Lotes.');
    return;
  }

  const st = effectiveLoteStatusPOS(parent);
  if (st === 'CERRADO'){
    alert('Este lote ya está CERRADO.');
    return;
  }
  if (Number(parent.assignedEventId || 0) !== Number(evId || 0)){
    alert('Este lote no corresponde al evento seleccionado.');
    return;
  }

  if (parent.sobranteLotId || lotHasSobranteChildPOS(allLotes, parent.id, evId)){
    alert('Ya existe un lote sobrante creado para este lote original (doble sobrante prevenido).');
    return;
  }

  const evs = await getAll('events');
  const ev = evs.find(e => e && Number(e.id) === Number(evId)) || null;
  const evName = ev ? (ev.name || '') : '';

  const nowIso = new Date().toISOString();
  const newId = 'lot-child-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,6);

  const child = {
    // Copiar lo que exista (materia prima / datos del lote) sin inventar
    ...parent,
    id: newId,
    codigo: makeSobranteCodePOS(evName || parent.assignedEventName || ('Evento ' + evId)),

    // Cantidades sobrantes (presentaciones)
    pulso: String(qty.P || 0),
    media: String(qty.M || 0),
    djeba: String(qty.D || 0),
    litro: String(qty.L || 0),
    galon: String(qty.G || 0),

    // Nuevo lote DISPONIBLE
    status: 'DISPONIBLE',
    assignedEventId: null,
    assignedEventName: '',
    assignedAt: null,

    // Trazabilidad
    parentLotId: parent.id,
    sourceEventId: evId,
    sourceEventName: evName || (parent.assignedEventName || ''),
    loteType: 'SOBRANTE',

    createdAt: nowIso
  };

  // Notas: dejar rastro sin romper lo existente
  try{
    const pcode = (parent.codigo || parent.name || parent.nombre || parent.id).toString();
    const line = `SOBRANTE del lote ${pcode} · Evento: ${child.sourceEventName || evId} · ${nowIso}`;
    child.notas = (parent.notas ? String(parent.notas).trim() + '\n' : '') + line;
  }catch(_){ }

  // Cerrar lote original (mantener Evento asignado visible)
  parent.status = 'CERRADO';
  parent.closedAt = nowIso;
  parent.sobranteLotId = newId;

  // Guardar
  const next = allLotes.map(l => (l && String(l.id) === String(parent.id)) ? parent : l);
  next.push(child);
  writeLotesLS_POS(next);

  await closeSobrantePanelPOS();
  await refreshSobranteUIForEventPOS(evId);
  toast('Lote sobrante creado y lote original cerrado');
}


// ==============================
// Reverso de asignación de lote (sin borrar historia)
// - Crea ajustes negativos en inventory (source: lote_reverso) para neutralizar la carga
// - Devuelve el lote a DISPONIBLE y limpia assignedEventId/Name
// - Bloqueo conservador: si hay consumo/ventas de esas presentaciones (o fraccionamiento de galones), no permite reversar
// ==============================

function setReversoPreviewPOS(vals){
  const set = (id, v)=>{ const el = document.getElementById(id); if (el) el.textContent = String(Math.max(0, Number(v||0))|0); };
  set('reverso-p', vals.P);
  set('reverso-m', vals.M);
  set('reverso-d', vals.D);
  set('reverso-l', vals.L);
  set('reverso-g', vals.G);
}

function resetReversoPreviewPOS(){
  setReversoPreviewPOS({P:0,M:0,D:0,L:0,G:0});
}

async function getRestockGroupForLotePOS(eventId, lote){
  const entries = await getInventoryEntries(eventId);
  const restocks = (entries || []).filter(e => e && e.type === 'restock' && (e.loteCodigo || e.loteId || e.loteCargaId || e.source === 'lote'));

  const wantCarga = (lote && lote.assignedCargaId) ? String(lote.assignedCargaId) : '';
  const wantId = (lote && lote.id != null) ? String(lote.id) : '';
  const wantCode = (lote && lote.codigo != null) ? normName(String(lote.codigo)) : '';

  let matches = restocks;
  if (wantCarga){
    matches = restocks.filter(r => r && r.loteCargaId != null && String(r.loteCargaId) === wantCarga);
  } else if (wantId){
    matches = restocks.filter(r => r && r.loteId != null && String(r.loteId) === wantId);
  } else if (wantCode){
    matches = restocks.filter(r => r && r.loteCodigo != null && normName(String(r.loteCodigo)) === wantCode);
  }

  if (!matches.length) return null;

  // Agrupar por loteCargaId si existe; si no, fallback a código|time (lotes viejos)
  const groups = new Map();
  for (const it of matches){
    const loteCodigo = (it.loteCodigo || '').toString().trim();
    const time = (it.time || '').toString();
    const gKey = it.loteCargaId
      ? String(it.loteCargaId)
      : ((loteCodigo || '—') + '|' + (time || ''));
    let g = groups.get(gKey);
    if (!g){
      g = { groupKey: gKey, loteCargaId: it.loteCargaId ? String(it.loteCargaId) : null, time: time || '', items: [] };
      groups.set(gKey, g);
    }
    if (!g.time && time) g.time = time;
    g.items.push(it);
  }

  const list = Array.from(groups.values()).sort((a,b)=> (b.time||'').localeCompare(a.time||''));
  return list.length ? list[0] : null;
}

async function summarizeRestockGroupPOS(group){
  const out = { P:0,M:0,D:0,L:0,G:0 };
  const sumsByPid = new Map();
  if (!group || !Array.isArray(group.items)) return { totals: out, sumsByPid, hasGallon: false };

  for (const it of group.items){
    const pid = it.productId;
    const qty = Number(it.qty) || 0;
    if (!pid || !(qty > 0)) continue;
    sumsByPid.set(pid, (Number(sumsByPid.get(pid))||0) + qty);
  }

  const prods = await getAll('products');
  const pMap = new Map((prods||[]).map(p => [p.id, p]));
  for (const [pid, qty] of sumsByPid.entries()){
    const p = pMap.get(pid);
    const key = presKeyFromProductNamePOS(p ? (p.name || '') : '');
    if (key && Object.prototype.hasOwnProperty.call(out, key)){
      out[key] = (Number(out[key]) || 0) + (Number(qty) || 0);
    }
  }
  const hasGallon = (Number(out.G) || 0) > 0;
  return { totals: out, sumsByPid, hasGallon };
}

async function validateReverseAssignPOS(eventId, group, sumsByPid, hasGallon){
  // 1) Evitar doble reverso
  const entries = await getInventoryEntries(eventId);
  const already = (entries || []).some(e => e && e.type === 'adjust' && e.source === 'lote_reverso' && (
    (group && group.groupKey && String(e.loteGroupKey || '') === String(group.groupKey)) ||
    (group && group.loteCargaId && String(e.loteCargaId || '') === String(group.loteCargaId))
  ));
  if (already){
    return { ok:false, reason:'Este lote ya fue reversado (se detectó un ajuste previo).'};
  }

  // 2) Bloqueo por ventas/consumo (proxy conservador)
  const sales = await getAll('sales');
  const pidSet = new Set(Array.from((sumsByPid || new Map()).keys()).map(n => Number(n)));
  const hasSalesForThese = (sales || []).some(s => s && Number(s.eventId) === Number(eventId) && pidSet.has(Number(s.productId)));
  if (hasSalesForThese){
    return { ok:false, reason:'No se puede reversar: ya existen ventas registradas de esas presentaciones en este evento.'};
  }

  // Si el lote incluye galones, bloquear si hubo fraccionamiento o ventas por vaso
  if (hasGallon){
    const ev = await getEventByIdPOS(eventId);
    const hasFraction = ev && Array.isArray(ev.fractionBatches) && ev.fractionBatches.length > 0;
    const hasCupSales = (sales || []).some(s => s && Number(s.eventId) === Number(eventId) && isCupSaleRecord(s));
    if (hasFraction || hasCupSales){
      return { ok:false, reason:'No se puede reversar: este evento ya tuvo fraccionamiento/ventas por vaso (consumo de galones).'};
    }
  }

  // 3) Stock actual debe cubrir el reverso (si no, algo ya consumió/ajustó)
  for (const [pid, qty] of (sumsByPid || new Map()).entries()){
    const need = Number(qty) || 0;
    if (!(need > 0)) continue;
    const st = Number(await computeStock(eventId, pid)) || 0;
    if (st < need){
      return { ok:false, reason:'No se puede reversar: el stock actual no alcanza para revertir esta carga (posible consumo o ajuste manual).'};
    }
  }

  return { ok:true, reason:'' };
}

async function refreshReversoUIForEventPOS(eventId){
  const btnOpen = document.getElementById('btn-reverse-assign');
  const panel = document.getElementById('reverso-panel');
  const sel = document.getElementById('reverso-lote-select');
  const meta = document.getElementById('reverso-lote-meta');
  if (!btnOpen || !panel || !sel) return;

  const lotes = readLotesLS_POS();
  const candidates = (lotes || []).filter(l => l && effectiveLoteStatusPOS(l) === 'EN_EVENTO' && Number(l.assignedEventId) === Number(eventId));

  // Botón habilitado solo si hay candidatos
  btnOpen.disabled = candidates.length === 0;
  if (candidates.length === 0){
    // si está abierto, lo cerramos para evitar panel vacío
    if (panel.style.display !== 'none') panel.style.display = 'none';
    if (meta) meta.textContent = 'No hay lotes EN_EVENTO en este evento.';
    sel.innerHTML = '';
    resetReversoPreviewPOS();
    return;
  }

  // Mantener selección si existe
  const prevVal = sel.value;
  sel.innerHTML = candidates.map(l => {
    const id = String(l.id);
    const code = (l.codigo || l.name || l.nombre || id).toString();
    return `<option value="${escapeHtml(id)}">${escapeHtml(code)}</option>`;
  }).join('');
  if (prevVal && candidates.some(l => String(l.id) === String(prevVal))){
    sel.value = prevVal;
  }

  // Actualizar meta/preview
  await updateReversoMetaPOS(eventId);
}

async function updateReversoMetaPOS(eventId){
  const sel = document.getElementById('reverso-lote-select');
  const meta = document.getElementById('reverso-lote-meta');
  if (!sel || !meta) return;

  const lotes = readLotesLS_POS();
  const lote = lotes.find(l => l && String(l.id) === String(sel.value)) || null;
  if (!lote){
    meta.textContent = 'Selecciona un lote.';
    resetReversoPreviewPOS();
    return;
  }

  const group = await getRestockGroupForLotePOS(eventId, lote);
  if (!group){
    meta.textContent = 'No se encontró la carga de inventario para este lote en el evento (datos viejos o incompletos).';
    resetReversoPreviewPOS();
    return;
  }

  const sum = await summarizeRestockGroupPOS(group);
  setReversoPreviewPOS(sum.totals);

  const chk = await validateReverseAssignPOS(eventId, group, sum.sumsByPid, sum.hasGallon);
  if (!chk.ok){
    meta.textContent = 'Bloqueado: ' + chk.reason;
  } else {
    const dt = group.time ? new Date(group.time).toLocaleString('es-NI') : '';
    meta.textContent = 'OK. Carga detectada ' + (dt ? ('(' + dt + '). ') : '') + 'Al reversar, el lote vuelve a DISPONIBLE.';
  }

  // Guardar en dataset para el botón (evitar reconsultas sencillas)
  const btnDo = document.getElementById('btn-reverso-do');
  if (btnDo){
    btnDo.dataset.groupKey = String(group.groupKey || '');
  }
}

function openReversoPanelPOS(){
  const panel = document.getElementById('reverso-panel');
  if (!panel) return;
  panel.style.display = 'block';
}

function closeReversoPanelPOS(){
  const panel = document.getElementById('reverso-panel');
  if (!panel) return;
  panel.style.display = 'none';
}

async function reverseAssignSelectedLotePOS(){
  const evId = parseInt((document.getElementById('inv-event') && document.getElementById('inv-event').value) || '0', 10);
  if (!evId) return alert('Selecciona un evento.');

  const sel = document.getElementById('reverso-lote-select');
  const meta = document.getElementById('reverso-lote-meta');
  if (!sel) return;

  const lotes = readLotesLS_POS();
  const idx = lotes.findIndex(l => l && String(l.id) === String(sel.value));
  if (idx < 0) return alert('No se encontró el lote seleccionado.');
  const lote = lotes[idx];

  if (effectiveLoteStatusPOS(lote) !== 'EN_EVENTO' || Number(lote.assignedEventId) !== Number(evId)){
    alert('Este lote ya no está EN_EVENTO en el evento actual.');
    await refreshReversoUIForEventPOS(evId);
    return;
  }

  const group = await getRestockGroupForLotePOS(evId, lote);
  if (!group){
    alert('No se encontró la carga de inventario de este lote en el evento.');
    return;
  }

  const sum = await summarizeRestockGroupPOS(group);
  const chk = await validateReverseAssignPOS(evId, group, sum.sumsByPid, sum.hasGallon);
  if (!chk.ok){
    alert('Reverso bloqueado: ' + chk.reason);
    if (meta) meta.textContent = 'Bloqueado: ' + chk.reason;
    return;
  }

  const reason = prompt(`REVERSO de asignación de lote #${lote.codigo || lote.id} — Motivo:`, '')
  if (reason === null) return; // cancelado
  const reasonTrim = String(reason || '').trim();

  const confirmMsg = `Se creará un reverso sin borrar historia:\n\n- Se registrarán ajustes negativos equivalentes a la carga.\n- El lote volverá a DISPONIBLE y reaparecerá en “Agregar desde lote”.\n\n¿Confirmas reversar la asignación?`;
  if (!confirm(confirmMsg)) return;

  const nowIso = new Date().toISOString();
  const revId = 'ra-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,6);

  // 1) Ajustes negativos (inventory)
  const noteBase = `REVERSO asignación lote ${lote.codigo || lote.id}` + (reasonTrim ? ` — Motivo: ${reasonTrim}` : '');
  for (const [pid, qty] of sum.sumsByPid.entries()){
    const n = Number(qty) || 0;
    if (!(n > 0)) continue;
    await put('inventory', {
      eventId: evId,
      productId: pid,
      type: 'adjust',
      qty: -n,
      time: nowIso,
      notes: noteBase,
      source: 'lote_reverso',
      reverseId: revId,
      loteId: (lote.id != null ? lote.id : null),
      loteCodigo: (lote.codigo || ''),
      loteCargaId: group.loteCargaId || null,
      loteGroupKey: group.groupKey || null,
      reversedReason: reasonTrim
    });
  }

  // 2) Devolver el lote a DISPONIBLE (sin borrar historia)
  const prev = {...lote};
  const hist = Array.isArray(prev.assignmentHistory) ? prev.assignmentHistory.slice() : [];
  hist.push({
    type: 'REVERSE_ASSIGN',
    at: nowIso,
    eventId: evId,
    eventName: (prev.assignedEventName || ''),
    reverseId: revId,
    loteGroupKey: group.groupKey || null,
    loteCargaId: group.loteCargaId || null,
    reason: reasonTrim
  });

  const line = `REVERSO asignación · Evento: ${prev.assignedEventName || evId} · ${nowIso}` + (reasonTrim ? ` · Motivo: ${reasonTrim}` : '');
  const nextNotas = (prev.notas ? String(prev.notas).trim() + '\n' : '') + line;

  lotes[idx] = {
    ...prev,
    status: 'DISPONIBLE',
    prevAssignedEventId: prev.assignedEventId,
    prevAssignedEventName: prev.assignedEventName,
    prevAssignedAt: prev.assignedAt,
    assignedEventId: null,
    assignedEventName: '',
    assignedAt: null,
    lastAssignedCargaId: (group.loteCargaId || prev.assignedCargaId || null),
    assignedCargaId: null,
    reversedAt: nowIso,
    reversedReason: reasonTrim,
    lastReverseId: revId,
    assignmentHistory: hist,
    notas: nextNotas
  };

  writeLotesLS_POS(lotes);

  await closeReversoPanelPOS();
  await renderInventario();
  await refreshReversoUIForEventPOS(evId);
  showToast('Asignación reversada. Lote disponible otra vez.', 'ok', 2800);

  // FIFO (Etapa 2): snapshot por evento/lote (reverso de asignación)
  try{ queueLotsUsageSyncPOS(evId); }catch(_){ }

}



// ------------------------------------------------------------
// POS Inventario — Reempaque (Etapa 2/5)
// UI colapsable genérica. Registra movimiento real de inventario, sin ventas ni caja.
// ------------------------------------------------------------
function reempaqueFmtQtyPOS(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round((n + Number.EPSILON) * 10000) / 10000;
  return String(rounded).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
}

function reempaqueFmtMlPOS(value){
  const n = reempaquePositivePOS(value);
  return n > 0 ? (reempaqueFmtQtyPOS(n) + ' ml') : '—';
}

function reempaqueCurrencyStatePOS(){
  if (window.A33Currency && typeof window.A33Currency.getState === 'function'){
    try{ return window.A33Currency.getState(); }catch(_){ }
  }
  let parsed = null;
  try{
    const key = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
    const raw = localStorage.getItem(key) || '';
    parsed = raw ? JSON.parse(raw) : null;
  }catch(_){ parsed = null; }
  const rawRate = String((parsed && parsed.exchangeRate) || '').trim().replace(',', '.');
  const okRate = /^\d+(?:\.\d{0,2})?$/.test(rawRate) && Number(rawRate) > 0;
  const rate = okRate ? Number(rawRate).toFixed(2) : '';
  return {
    primary: { name:'Córdoba nicaragüense', symbol:'C$', code:'NIO' },
    secondary: { name:'Dólar estadounidense', symbol:'US$', code:'USD' },
    exchangeRate: rate ? Number(rate) : null,
    exchangeRateText: rate ? ('T/C ' + rate) : 'T/C no configurado',
    hasExchangeRate: !!rate,
    settings: { updatedAt: (parsed && parsed.updatedAt) || '', exchangeRate: rate }
  };
}

function reempaqueFormatCordobasPOS(value){
  const n = reempaqueMoneyPOS(value);
  if (window.A33Currency && typeof window.A33Currency.formatCordobas === 'function'){
    try{ return window.A33Currency.formatCordobas(n); }catch(_){ }
  }
  const fixed = Math.abs(n).toFixed(2);
  const parts = fixed.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + 'C$' + intPart + '.' + (parts[1] || '00');
}

function reempaqueFmtMoneyPOS(value, emptyText){
  const n = reempaqueMoneyPOS(value);
  if (!(n > 0)) return emptyText || 'N/D';
  return reempaqueFormatCordobasPOS(n);
}

function reempaqueUpdateCurrencyNotePOS(){
  const state = reempaqueCurrencyStatePOS();
  const primary = state.primary || { symbol:'C$', code:'NIO' };
  const text = state.hasExchangeRate
    ? `Moneda: ${primary.symbol || 'C$'} / ${primary.code || 'NIO'} · ${state.exchangeRateText}. Sin conversiones automáticas.`
    : 'T/C no configurado en Moneda. Reempaque sigue operando en C$ sin conversiones silenciosas.';
  ['rp-currency-note', 'rp-multi-currency-note'].forEach((id)=>{
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('warn', !state.hasExchangeRate);
  });
  return state;
}

function reempaqueSetMsgPOS(msg, type){
  const el = document.getElementById('rp-msg');
  if (!el) return;
  el.textContent = String(msg || '');
  el.classList.remove('warn','ok');
  if (type) el.classList.add(type);
}

function reempaqueSetFieldInvalidPOS(id, bad){
  const el = document.getElementById(id);
  if (el && el.classList) el.classList.toggle('a33-invalid', !!bad);
}

function reempaqueSetOpenPOS(open){
  const panel = document.getElementById('reempaque-panel');
  const btn = document.getElementById('btn-toggle-reempaque');
  if (!panel || !btn) return;
  panel.classList.toggle('is-collapsed', !open);
  btn.textContent = open ? 'Ocultar Reempaque' : 'Mostrar Reempaque';
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open){
    reempaqueSetMsgPOS('', '');
    reempaqueUpdateCurrencyNotePOS();
    reempaqueRefreshUiPOS().catch(err=>console.warn('No se pudo refrescar Reempaque', err));
  }
}

function reempaqueIsOpenPOS(){
  const panel = document.getElementById('reempaque-panel');
  return !!(panel && !panel.classList.contains('is-collapsed'));
}

async function reempaqueSelectableProductsPOS(){
  // Reempaque consume productos reales y activos exactamente como existen en Catálogos.
  // No agrupa, completa ni identifica por nombre; cada opción conserva su identidad real.
  const all = await getAll('products').catch(()=>[]);
  return (Array.isArray(all) ? all : [])
    .filter(p => p && p.id != null && p.active !== false && p.deleted !== true)
    .sort((a,b)=>{
      const rank = (name)=>{
        const k = (typeof mapProductNameToFinishedId === 'function') ? mapProductNameToFinishedId(name || '') : '';
        const order = { pulso:1, media:2, djeba:3, litro:4, galon:5 };
        return order[k || ''] || 99;
      };
      const ra = rank(a && a.name);
      const rb = rank(b && b.name);
      if (ra !== rb) return ra - rb;
      const byName = String(a.name || '').localeCompare(String(b.name || ''), 'es-NI', { sensitivity:'base' });
      if (byName) return byName;
      return String(a.productId || a.id || '').localeCompare(String(b.productId || b.id || ''));
    });
}

function reempaqueFindProductPOS(products, id){
  const sid = String(id || '').trim();
  if (!sid) return null;
  return (Array.isArray(products) ? products : []).find(p => p && String(p.id) === sid) || null;
}

function reempaqueFindProductByNamePOS(products, name){
  const raw = String(name || '').trim();
  if (!raw) return null;
  const key = (typeof normKeyPOS === 'function') ? normKeyPOS(raw) : raw.toLowerCase().replace(/\s+/g,'');
  return (Array.isArray(products) ? products : []).find(p => {
    const pname = String((p && (p.name || p.nombre)) || '').trim();
    const pkey = (typeof normKeyPOS === 'function') ? normKeyPOS(pname) : pname.toLowerCase().replace(/\s+/g,'');
    return pkey && pkey === key;
  }) || null;
}

function reempaqueReadNewTargetPOS(){
  // Campos legacy ignorados incluso si un HTML antiguo quedó en caché.
  return { name:'', capacityMl:0, price:0 };
}

async function reempaqueEnsureCentralTargetProductPOS(input){
  if (!db) await openDB();
  const ref = (input && typeof input === 'object') ? input : {};
  const internalId = String(ref.id ?? ref.legacyId ?? '').trim();
  const productId = String(ref.productId ?? ref.productoId ?? ref.catalogProductId ?? '').trim();
  if (!internalId && !productId) return null;

  const products = await getAll('products').catch(()=>[]);
  const existing = (Array.isArray(products) ? products : []).find((p) => {
    if (!p || p.active === false || p.deleted === true) return false;
    const pInternalId = String(p.id ?? '').trim();
    const pProductId = String(p.productId ?? p.productoId ?? p.catalogProductId ?? '').trim();
    return (!!internalId && pInternalId === internalId) || (!!productId && pProductId === productId);
  }) || null;

  return existing ? { ...existing, __rpqCreated:false, __rpqMatchedExisting:true } : null;
}

async function reempaqueRollbackCreatedTargetProductsPOS(createdTargets){
  // Ya no existen destinos creados por Reempaque; no borrar productos desde aquí.
  void createdTargets;
  return { ok:true, skipped:true };
}

function reempaqueGetSourceCostInfoPOS(productLike){
  const p = (productLike && typeof productLike === 'object') ? productLike : {};
  const candidates = [
    p.unitCost, p.costoUnitario, p.costoUnidad, p.costPerUnit, p.sourceUnitCost,
    p.costo, p.cost, p.precioCosto, p.productCost, p.costoEstimado
  ];
  for (const c of candidates){
    const n = reempaqueMoneyPOS(c);
    if (n > 0) return { value:n, source:'producto' };
  }
  const name = reempaqueProductNameFromRefPOS(p);
  if (name && typeof getCostoUnitarioProducto === 'function'){
    const n = reempaqueMoneyPOS(getCostoUnitarioProducto(name));
    if (n > 0) return { value:n, source:'calculadora' };
  }
  return { value:0, source:'' };
}

function reempaqueSyncSourceCostFieldPOS(source){
  const el = document.getElementById('rp-source-unit-cost');
  const info = source ? reempaqueGetSourceCostInfoPOS(source) : { value:0, source:'' };
  if (!el) return info;

  const sourceKey = source ? String(source.id ?? source.name ?? source.nombre ?? '') : '';
  const previousKey = String(el.dataset.rpqSourceKey || '');
  const currentValue = String(el.value || '').trim();
  const isAuto = el.dataset.rpqAutoCost !== '0';

  if (previousKey !== sourceKey){
    el.dataset.rpqSourceKey = sourceKey;
    if (info.value > 0){
      el.value = reempaqueFmtQtyPOS(info.value);
      el.dataset.rpqAutoCost = '1';
    }else{
      el.value = '';
      el.dataset.rpqAutoCost = '1';
    }
  }else if ((!currentValue || isAuto) && info.value > 0){
    el.value = reempaqueFmtQtyPOS(info.value);
    el.dataset.rpqAutoCost = '1';
  }
  return info;
}

function reempaqueBuildProductOptionTextPOS(p){
  const name = String((p && p.name) || 'Producto').trim();
  const cap = reempaqueCapacityMlFromProductPOS(p);
  const flags = [];
  if (cap > 0) flags.push(reempaqueFmtMlPOS(cap));
  if (p && p.active === false) flags.push('inactivo');
  return name + (flags.length ? ' (' + flags.join(' · ') + ')' : '');
}

async function reempaqueFillSelectPOS(sel, products){
  if (!sel) return;
  const prev = String(sel.value || '').trim();
  sel.innerHTML = '';
  const list = Array.isArray(products) ? products : [];
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = list.length ? 'Seleccionar producto' : 'Sin productos activos en Catálogos';
  sel.appendChild(ph);
  for (const p of list){
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = reempaqueBuildProductOptionTextPOS(p);
    const cap = reempaqueCapacityMlFromProductPOS(p);
    if (cap > 0) opt.dataset.capacityMl = String(cap);
    sel.appendChild(opt);
  }
  if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
}

async function reempaquePopulateSelectorsPOS(){
  const products = await reempaqueSelectableProductsPOS();
  await reempaqueFillSelectPOS(document.getElementById('rp-source-product'), products);
  await reempaqueFillSelectPOS(document.getElementById('rp-target-product'), products);
  const multiSelects = Array.from(document.querySelectorAll('.rp-multi-target-product'));
  for (const sel of multiSelects){
    await reempaqueFillSelectPOS(sel, products);
  }
  return products;
}

async function reempaqueGetUiStatePOS(productsArg){
  const products = Array.isArray(productsArg) ? productsArg : await reempaqueSelectableProductsPOS();
  const sourceEl = document.getElementById('rp-source-product');
  const targetEl = document.getElementById('rp-target-product');
  const qtySourceEl = document.getElementById('rp-source-qty');
  const qtyTargetEl = document.getElementById('rp-target-qty');
  const unitCostEl = document.getElementById('rp-source-unit-cost');
  const extraCostEl = document.getElementById('rp-extra-cost');
  const source = reempaqueFindProductPOS(products, sourceEl ? sourceEl.value : '');
  const selectedTarget = reempaqueFindProductPOS(products, targetEl ? targetEl.value : '');
  const target = selectedTarget;
  const newTarget = { name:'', capacityMl:0, price:0 };
  const sourceCostInfo = reempaqueSyncSourceCostFieldPOS(source);
  const qtySource = reempaquePositivePOS(qtySourceEl ? qtySourceEl.value : 0);
  const qtyTarget = reempaquePositivePOS(qtyTargetEl ? qtyTargetEl.value : 0);
  const sourceCap = source ? reempaqueCapacityMlFromProductPOS(source) : 0;
  const targetCap = target ? reempaqueCapacityMlFromProductPOS(target) : 0;
  const suggested = reempaqueComputeSuggestedQtyByVolumePOS(qtySource, sourceCap, targetCap);
  const fieldUnitCost = reempaqueMoneyPOS(unitCostEl ? unitCostEl.value : 0);
  const fieldIsManual = !!(unitCostEl && unitCostEl.dataset.rpqAutoCost === '0' && fieldUnitCost > 0);
  const unitCost = fieldUnitCost > 0 ? fieldUnitCost : reempaqueMoneyPOS(sourceCostInfo.value);
  const unitCostSource = fieldIsManual ? 'manual' : (sourceCostInfo.source || (unitCost > 0 ? 'manual' : ''));
  const extraCostInfo = reempaqueInputNumberInfoPOS(extraCostEl);
  const costAdditionalUnit = extraCostInfo.value > 0 ? round2(extraCostInfo.value) : 0;
  const costAdditionalTotal = (qtyTarget > 0 && costAdditionalUnit > 0) ? round2(qtyTarget * costAdditionalUnit) : 0;
  const costOriginTotal = (unitCost > 0 && qtySource > 0) ? round2(unitCost * qtySource) : 0;
  const liquidUnitTarget = (costOriginTotal > 0 && qtyTarget > 0) ? round2(costOriginTotal / qtyTarget) : 0;
  const costTotal = (costOriginTotal > 0 || costAdditionalTotal > 0) ? round2(costOriginTotal + costAdditionalTotal) : 0;
  const unitTarget = (costTotal > 0 && qtyTarget > 0) ? round2(costTotal / qtyTarget) : 0;
  return {
    products, source, target, selectedTarget, newTarget, qtySource, qtyTarget, sourceCap, targetCap, suggested,
    unitCost, unitCostSource, costOriginTotal,
    extraCostInfo, costAdditionalUnit, costAdditionalTotal,
    costAdditional: costAdditionalTotal,
    liquidUnitTarget, costTotal, unitTarget
  };
}

async function reempaqueUpdatePreviewPOS(opts){
  opts = opts || {};
  reempaqueUpdateCurrencyNotePOS();
  const state = await reempaqueGetUiStatePOS(opts.products);
  const sourceCapEl = document.getElementById('rp-source-capacity');
  const targetCapEl = document.getElementById('rp-target-capacity');
  const suggestedEl = document.getElementById('rp-suggested-qty');
  const costOriginEl = document.getElementById('rp-cost-origin-total');
  const costAdditionalUnitEl = document.getElementById('rp-cost-additional-unit');
  const targetQtySummaryEl = document.getElementById('rp-cost-target-qty');
  const costAdditionalEl = document.getElementById('rp-cost-additional-total');
  const liquidDistributedEl = document.getElementById('rp-cost-liquid-distributed');
  const liquidUnitEl = document.getElementById('rp-cost-liquid-unit');
  const costTotalEl = document.getElementById('rp-cost-total-used');
  const unitTargetEl = document.getElementById('rp-cost-unit-target');
  const qtyTargetEl = document.getElementById('rp-target-qty');

  if (sourceCapEl) sourceCapEl.textContent = reempaqueFmtMlPOS(state.sourceCap);
  if (targetCapEl) targetCapEl.textContent = reempaqueFmtMlPOS(state.targetCap);
  if (suggestedEl) suggestedEl.textContent = (state.suggested !== null && state.suggested > 0) ? reempaqueFmtQtyPOS(state.suggested) : '—';

  if (qtyTargetEl && state.suggested !== null && state.suggested > 0){
    const cur = String(qtyTargetEl.value || '').trim();
    const auto = qtyTargetEl.dataset.rpqAuto === '1';
    if (!cur || auto || opts.forceSuggested){
      qtyTargetEl.value = reempaqueFmtQtyPOS(state.suggested);
      qtyTargetEl.dataset.rpqAuto = '1';
      state.qtyTarget = reempaquePositivePOS(qtyTargetEl.value);
      state.costAdditionalTotal = (state.qtyTarget > 0 && state.costAdditionalUnit > 0) ? round2(state.qtyTarget * state.costAdditionalUnit) : 0;
      state.costAdditional = state.costAdditionalTotal;
      state.liquidUnitTarget = (state.costOriginTotal > 0 && state.qtyTarget > 0) ? round2(state.costOriginTotal / state.qtyTarget) : 0;
      state.costTotal = (state.costOriginTotal > 0 || state.costAdditionalTotal > 0) ? round2(state.costOriginTotal + state.costAdditionalTotal) : 0;
      state.unitTarget = (state.costTotal > 0 && state.qtyTarget > 0) ? round2(state.costTotal / state.qtyTarget) : 0;
    }
  }

  if (costOriginEl) costOriginEl.textContent = reempaqueFmtMoneyPOS(state.costOriginTotal);
  if (costAdditionalUnitEl) costAdditionalUnitEl.textContent = reempaqueFmtMoneyPOS(state.costAdditionalUnit, reempaqueFormatCordobasPOS(0));
  if (targetQtySummaryEl) targetQtySummaryEl.textContent = state.qtyTarget > 0 ? reempaqueFmtQtyPOS(state.qtyTarget) : '—';
  if (costAdditionalEl) costAdditionalEl.textContent = reempaqueFmtMoneyPOS(state.costAdditionalTotal, reempaqueFormatCordobasPOS(0));
  if (liquidDistributedEl) liquidDistributedEl.textContent = reempaqueFmtMoneyPOS(state.costOriginTotal);
  if (liquidUnitEl) liquidUnitEl.textContent = reempaqueFmtMoneyPOS(state.liquidUnitTarget);
  if (costTotalEl) costTotalEl.textContent = reempaqueFmtMoneyPOS(state.costTotal);
  if (unitTargetEl) unitTargetEl.textContent = reempaqueFmtMoneyPOS(state.unitTarget);
  return state;
}

// Reempaque múltiple — UI dinámica sobre la base interna de Etapa 1/3.
function reempaqueGetModePOS(){
  const checked = document.querySelector('input[name="rp-mode"]:checked');
  const mode = checked ? String(checked.value || '').toUpperCase() : 'SIMPLE';
  return mode === 'MULTIPLE' ? 'MULTIPLE' : 'SIMPLE';
}

function reempaqueSetModeUiPOS(mode){
  const finalMode = String(mode || '').toUpperCase() === 'MULTIPLE' ? 'MULTIPLE' : 'SIMPLE';
  const panel = document.getElementById('reempaque-panel');
  if (panel){
    panel.classList.toggle('rp-mode-multiple', finalMode === 'MULTIPLE');
    panel.classList.toggle('rp-mode-simple', finalMode !== 'MULTIPLE');
  }
  const radio = document.querySelector(`input[name="rp-mode"][value="${finalMode}"]`);
  if (radio) radio.checked = true;
  if (finalMode === 'MULTIPLE') reempaqueEnsureMultiDestinationRowsPOS();
  return finalMode;
}

function reempaqueFmtMlSignedPOS(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 0.0001) return '0 ml';
  const sign = n < 0 ? '-' : '';
  return sign + reempaqueFmtQtyPOS(Math.abs(n)) + ' ml';
}

function reempaqueFmtMoneySignedPOS(value, emptyText){
  const n = Number(value);
  if (!Number.isFinite(n)) return emptyText || 'N/D';
  if (Math.abs(n) < 0.005) return reempaqueFormatCordobasPOS(0);
  const sign = n < 0 ? '-' : '';
  return sign + reempaqueFormatCordobasPOS(Math.abs(round2(n)));
}

function reempaqueFmtCostPerMlPOS(value){
  const n = Number(value);
  if (!Number.isFinite(n) || !(n > 0)) return 'N/D';
  const state = reempaqueCurrencyStatePOS();
  const symbol = (state.primary && state.primary.symbol) ? state.primary.symbol : 'C$';
  return symbol + reempaqueFmtQtyPOS(reempaqueRound4POS(n));
}

function reempaqueSetTextPOS(id, text){
  const el = document.getElementById(id);
  if (el) el.textContent = String(text);
}

function reempaqueSetElementInvalidPOS(el, bad){
  if (el && el.classList) el.classList.toggle('a33-invalid', !!bad);
}

function reempaqueInputNumberInfoPOS(el){
  const raw = String((el && el.value) || '').trim();
  if (!raw) return { raw, empty:true, invalid:false, value:0 };
  const n = Number(raw.replace(',', '.'));
  return { raw, empty:false, invalid:!Number.isFinite(n), value:n };
}

function reempaqueGetMultiDestinationKindPOS(card){
  // Reempaque solo admite productos existentes del catálogo.
  const selector = card?.querySelector('.rp-multi-target-kind');
  if (selector) selector.value = 'EXISTING';
  return 'EXISTING';
}

function reempaqueApplyMultiDestinationKindUiPOS(card){
  if (!card) return 'EXISTING';
  const selector = card.querySelector('.rp-multi-target-kind');
  if (selector){ selector.value = 'EXISTING'; selector.disabled = true; }
  card.classList.remove('rp-multi-new-mode');
  card.classList.add('rp-multi-existing-mode');
  const existingWrap = card.querySelector('.rp-multi-existing-wrap');
  const newWrap = card.querySelector('.rp-multi-new-wrap');
  if (existingWrap) existingWrap.hidden = false;
  if (newWrap) newWrap.hidden = true;
  return 'EXISTING';
}

function reempaqueReadMultiNewTargetPOS(card){
  void card;
  return { name:'', capacityMl:0, price:0 };
}

function reempaqueDescribeDestinationKindPOS(rawKind){
  const kind = String(rawKind || '').toUpperCase();
  if (kind === 'NUEVO_EXISTENTE') return 'Nuevo (ya existía)';
  if (kind === 'NUEVO' || kind === 'NEW') return 'Nuevo';
  return 'Existente';
}

function reempaqueSyncSourceVolumeFieldPOS(source){
  const el = document.getElementById('rp-source-total-ml-manual');
  if (!el) return;
  const key = source ? String(source.id ?? source.name ?? source.nombre ?? '') : '';
  const prev = String(el.dataset.rpqSourceKey || '');
  if (prev !== key){
    el.dataset.rpqSourceKey = key;
    el.value = '';
  }
}

function reempaqueMultiRowIdPOS(){
  const ts = Date.now ? Date.now() : (new Date()).getTime();
  return `rpqd_${ts}_${Math.random().toString(36).slice(2,7)}`;
}

function reempaqueCreateMultiDestinationCardPOS(){
  const id = reempaqueMultiRowIdPOS();
  const card = document.createElement('article');
  card.className = 'reempaque-dest-card rp-multi-existing-mode';
  card.dataset.rpqRow = id;
  card.innerHTML = `
    <div class="reempaque-dest-head">
      <b class="rp-multi-dest-title">Destino</b>
      <button class="btn-danger btn-pill btn-pill-mini rp-multi-remove" type="button">Quitar</button>
    </div>
    <div class="rp-multi-existing-wrap">
      <label>Producto destino</label>
      <select class="rp-multi-target-product"></select>
      <small class="muted">Solo productos activos creados previamente en Catálogos → Productos.</small>
    </div>
    <div class="reempaque-mini-grid">
      <div>
        <label>Cantidad creada</label>
        <input class="rp-multi-target-qty a33-num" data-a33-default="0" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Ej: 6">
      </div>
      <div>
        <label>ml por unidad</label>
        <input class="rp-multi-target-ml a33-num" data-a33-default="0" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Ej: 300">
      </div>
      <div>
        <label>Costo adicional unitario</label>
        <input class="rp-multi-extra-unit-cost a33-num" data-a33-default="0" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Ej: 25">
      </div>
    </div>
    <div class="reempaque-kv"><span>Volumen total destino</span><b class="rp-multi-target-volume">—</b></div>
    <div class="reempaque-kv"><span>Costo líquido unitario</span><b class="rp-multi-liquid-unit-cost">N/D</b></div>
    <div class="reempaque-kv"><span>Costo adicional total</span><b class="rp-multi-extra-total-cost">N/D</b></div>
    <div class="reempaque-kv"><span>Costo final unitario</span><b class="rp-multi-target-unit-cost">N/D</b></div>
    <div class="reempaque-kv"><span>Costo total destino</span><b class="rp-multi-target-total-cost">N/D</b></div>
  `;
  return card;
}

function reempaqueRefreshMultiDestinationLabelsPOS(){
  const cards = Array.from(document.querySelectorAll('#rp-multi-destinations .reempaque-dest-card'));
  cards.forEach((card, idx)=>{
    const title = card.querySelector('.rp-multi-dest-title');
    if (title) title.textContent = `Destino ${idx + 1}`;
    const rm = card.querySelector('.rp-multi-remove');
    if (rm) rm.disabled = cards.length <= 1;
  });
}

function reempaqueEnsureMultiDestinationRowsPOS(){
  const list = document.getElementById('rp-multi-destinations');
  if (!list) return;
  if (!list.querySelector('.reempaque-dest-card')){
    list.appendChild(reempaqueCreateMultiDestinationCardPOS());
  }
  reempaqueRefreshMultiDestinationLabelsPOS();
}

async function reempaqueAddMultiDestinationRowPOS(){
  const list = document.getElementById('rp-multi-destinations');
  if (!list) return null;
  const card = reempaqueCreateMultiDestinationCardPOS();
  list.appendChild(card);
  const products = await reempaqueSelectableProductsPOS();
  const sel = card.querySelector('.rp-multi-target-product');
  await reempaqueFillSelectPOS(sel, products);
  reempaqueRefreshMultiDestinationLabelsPOS();
  await reempaqueUpdateMultiplePreviewPOS({ products });
  try{ sel && sel.focus(); }catch(_){ }
  return card;
}

function reempaqueRemoveMultiDestinationRowPOS(btn){
  const card = btn && btn.closest ? btn.closest('.reempaque-dest-card') : null;
  if (!card) return;
  const list = document.getElementById('rp-multi-destinations');
  const total = list ? list.querySelectorAll('.reempaque-dest-card').length : 0;
  if (total <= 1) return;
  card.remove();
  reempaqueRefreshMultiDestinationLabelsPOS();
}

function reempaqueReadMultiDestinationRowsPOS(products, costoPorMl){
  const rows = [];
  const cards = Array.from(document.querySelectorAll('#rp-multi-destinations .reempaque-dest-card'));
  cards.forEach((card, idx)=>{
    const kind = reempaqueApplyMultiDestinationKindUiPOS(card);
    const isNewTarget = kind === 'NEW';
    const sel = card.querySelector('.rp-multi-target-product');
    const qtyEl = card.querySelector('.rp-multi-target-qty');
    const mlEl = card.querySelector('.rp-multi-target-ml');
    const extraEl = card.querySelector('.rp-multi-extra-unit-cost');
    const newNameEl = card.querySelector('.rp-multi-new-target-name');
    const newCapEl = card.querySelector('.rp-multi-new-target-capacity');
    const newPriceEl = card.querySelector('.rp-multi-new-target-price');
    const newTarget = reempaqueReadMultiNewTargetPOS(card);
    const existingNewTarget = isNewTarget && newTarget.name ? reempaqueFindProductByNamePOS(products, newTarget.name) : null;
    const selectedTarget = reempaqueFindProductPOS(products, sel ? sel.value : '');
    const target = isNewTarget
      ? (existingNewTarget || (newTarget.name ? {
          id: `__new_multi_target_${idx + 1}`,
          name: newTarget.name,
          price: newTarget.price > 0 ? newTarget.price : 0,
          capacityMl: newTarget.capacityMl > 0 ? newTarget.capacityMl : null,
          capacidadMl: newTarget.capacityMl > 0 ? newTarget.capacityMl : null,
          active: true,
          manageStock: true,
          __rpqNewTarget: true
        } : null))
      : selectedTarget;
    const cap = isNewTarget
      ? (newTarget.capacityMl > 0 ? newTarget.capacityMl : (target ? reempaqueCapacityMlFromProductPOS(target) : 0))
      : (target ? reempaqueCapacityMlFromProductPOS(target) : 0);
    if (mlEl){
      const cur = String(mlEl.value || '').trim();
      const auto = mlEl.dataset.rpqAuto === '1';
      if (target && cap > 0 && (!cur || auto)){
        mlEl.value = reempaqueFmtQtyPOS(cap);
        mlEl.dataset.rpqAuto = '1';
      }
    }
    const qtyInfo = reempaqueInputNumberInfoPOS(qtyEl);
    const mlInfo = reempaqueInputNumberInfoPOS(mlEl);
    const extraInfo = reempaqueInputNumberInfoPOS(extraEl);
    const newCapInfo = reempaqueInputNumberInfoPOS(newCapEl);
    const newPriceInfo = reempaqueInputNumberInfoPOS(newPriceEl);
    const qty = qtyInfo.value > 0 ? qtyInfo.value : 0;
    const ml = mlInfo.value > 0 ? mlInfo.value : 0;
    const extraUnitCost = extraInfo.value > 0 ? extraInfo.value : 0;
    const volume = reempaqueTotalVolumePOS(qty, ml);
    const liquidTotalCost = (costoPorMl > 0 && volume > 0) ? round2(volume * costoPorMl) : 0;
    const liquidUnitCost = (qty > 0 && liquidTotalCost > 0) ? round2(liquidTotalCost / qty) : 0;
    const extraTotalCost = (qty > 0 && extraUnitCost > 0) ? round2(qty * extraUnitCost) : 0;
    const totalCost = round2(liquidTotalCost + extraTotalCost);
    const unitCost = (qty > 0 && totalCost > 0) ? round2(totalCost / qty) : 0;
    rows.push({
      card, index:idx, kind, isNewTarget, selectEl:sel, qtyEl, mlEl, extraEl, newNameEl, newCapEl, newPriceEl,
      qtyInfo, mlInfo, extraInfo, newCapInfo, newPriceInfo, newTarget, existingNewTarget, selectedTarget, target, cap, qty, ml, volume,
      liquidTotalCost, liquidUnitCost, extraUnitCost, extraTotalCost,
      totalCost, unitCost
    });
  });
  return rows;
}

async function reempaqueGetMultipleUiStatePOS(productsArg){
  const products = Array.isArray(productsArg) ? productsArg : await reempaqueSelectableProductsPOS();
  reempaqueEnsureMultiDestinationRowsPOS();
  const sourceEl = document.getElementById('rp-source-product');
  const qtySourceEl = document.getElementById('rp-source-qty');
  const unitCostEl = document.getElementById('rp-source-unit-cost');
  const volumeManualEl = document.getElementById('rp-source-total-ml-manual');
  const evEl = document.getElementById('inv-event');
  const eventId = evEl && evEl.value ? parseInt(evEl.value, 10) : 0;
  const source = reempaqueFindProductPOS(products, sourceEl ? sourceEl.value : '');
  reempaqueSyncSourceCostFieldPOS(source);
  reempaqueSyncSourceVolumeFieldPOS(source);
  const sourceCostInfo = source ? reempaqueGetSourceCostInfoPOS(source) : { value:0, source:'' };
  const qtySourceInfo = reempaqueInputNumberInfoPOS(qtySourceEl);
  const unitCostInfo = reempaqueInputNumberInfoPOS(unitCostEl);
  const volumeManualInfo = reempaqueInputNumberInfoPOS(volumeManualEl);
  const qtySource = qtySourceInfo.value > 0 ? qtySourceInfo.value : 0;
  const sourceUnitMl = source ? reempaqueCapacityMlFromProductPOS(source) : 0;
  const autoVolumeOrigin = reempaqueTotalVolumePOS(qtySource, sourceUnitMl);
  const volumeOrigin = volumeManualInfo.value > 0 ? reempaqueRound4POS(volumeManualInfo.value) : autoVolumeOrigin;
  const unitCost = unitCostInfo.value > 0 ? unitCostInfo.value : reempaqueMoneyPOS(sourceCostInfo.value);
  const unitCostSource = (unitCostEl && unitCostEl.dataset.rpqAutoCost === '0') ? 'manual' : (sourceCostInfo.source || (unitCost > 0 ? 'manual' : ''));
  const costOriginTotal = (unitCost > 0 && qtySource > 0) ? round2(unitCost * qtySource) : 0;
  const costPerMl = reempaqueCostPerMlPOS(costOriginTotal, volumeOrigin);
  const destinations = reempaqueReadMultiDestinationRowsPOS(products, costPerMl);
  const volumeDistributed = reempaqueRound4POS(destinations.reduce((a,d)=>a + reempaquePositivePOS(d.volume), 0));
  const liquidCostDistributed = round2(destinations.reduce((a,d)=>a + reempaqueMoneyPOS(d.liquidTotalCost), 0));
  const additionalCostTotal = round2(destinations.reduce((a,d)=>a + reempaqueMoneyPOS(d.extraTotalCost), 0));
  const costDistributed = round2(destinations.reduce((a,d)=>a + reempaqueMoneyPOS(d.totalCost), 0));
  const volumeLeft = reempaqueRound4POS(volumeOrigin - volumeDistributed);
  const costLeft = round2(costOriginTotal - liquidCostDistributed);
  let stockSource = null;
  if (eventId && source && source.id != null){
    try{ stockSource = reempaqueInventoryQtyPOS(await computeStock(eventId, source.id)); }catch(_){ stockSource = null; }
  }
  return {
    products, eventId, source, sourceEl, qtySourceEl, unitCostEl, volumeManualEl,
    qtySourceInfo, unitCostInfo, volumeManualInfo,
    qtySource, sourceUnitMl, autoVolumeOrigin, volumeOrigin, unitCost, unitCostSource,
    costOriginTotal, costPerMl, destinations, volumeDistributed, liquidCostDistributed, additionalCostTotal, costDistributed, volumeLeft, costLeft, stockSource
  };
}

async function reempaqueUpdateMultiplePreviewPOS(opts){
  opts = opts || {};
  reempaqueUpdateCurrencyNotePOS();
  const state = await reempaqueGetMultipleUiStatePOS(opts.products);
  reempaqueSetTextPOS('rp-multi-source-name', state.source ? (state.source.name || 'Producto') : '—');
  reempaqueSetTextPOS('rp-multi-source-qty', state.qtySource > 0 ? reempaqueFmtQtyPOS(state.qtySource) : '—');
  reempaqueSetTextPOS('rp-multi-source-total-ml', state.volumeOrigin > 0 ? reempaqueFmtMlPOS(state.volumeOrigin) : '—');
  reempaqueSetTextPOS('rp-multi-cost-origin-total', reempaqueFmtMoneyPOS(state.costOriginTotal));
  reempaqueSetTextPOS('rp-multi-cost-per-ml', reempaqueFmtCostPerMlPOS(state.costPerMl));
  reempaqueSetTextPOS('rp-multi-source-stock', state.stockSource === null ? '—' : reempaqueFmtQtyPOS(state.stockSource));
  reempaqueSetTextPOS('rp-multi-volume-origin', state.volumeOrigin > 0 ? reempaqueFmtMlPOS(state.volumeOrigin) : '—');
  reempaqueSetTextPOS('rp-multi-volume-distributed', state.volumeDistributed > 0 ? reempaqueFmtMlPOS(state.volumeDistributed) : '—');
  reempaqueSetTextPOS('rp-multi-volume-left', state.volumeOrigin > 0 ? reempaqueFmtMlSignedPOS(state.volumeLeft) : '—');
  reempaqueSetTextPOS('rp-multi-cost-origin', reempaqueFmtMoneyPOS(state.costOriginTotal));
  reempaqueSetTextPOS('rp-multi-cost-distributed', reempaqueFmtMoneyPOS(state.liquidCostDistributed));
  reempaqueSetTextPOS('rp-multi-cost-additional', reempaqueFmtMoneyPOS(state.additionalCostTotal, reempaqueFormatCordobasPOS(0)));
  reempaqueSetTextPOS('rp-multi-cost-final', reempaqueFmtMoneyPOS(state.costDistributed));
  reempaqueSetTextPOS('rp-multi-cost-left', state.costOriginTotal > 0 ? reempaqueFmtMoneySignedPOS(state.costLeft) : 'N/D');

  state.destinations.forEach(d=>{
    const volEl = d.card.querySelector('.rp-multi-target-volume');
    const liquidUnitEl = d.card.querySelector('.rp-multi-liquid-unit-cost');
    const extraTotalEl = d.card.querySelector('.rp-multi-extra-total-cost');
    const unitEl = d.card.querySelector('.rp-multi-target-unit-cost');
    const totalEl = d.card.querySelector('.rp-multi-target-total-cost');
    if (volEl) volEl.textContent = d.volume > 0 ? reempaqueFmtMlPOS(d.volume) : '—';
    if (liquidUnitEl) liquidUnitEl.textContent = reempaqueFmtMoneyPOS(d.liquidUnitCost);
    if (extraTotalEl) extraTotalEl.textContent = reempaqueFmtMoneyPOS(d.extraTotalCost, reempaqueFormatCordobasPOS(0));
    if (unitEl) unitEl.textContent = reempaqueFmtMoneyPOS(d.unitCost);
    if (totalEl) totalEl.textContent = reempaqueFmtMoneyPOS(d.totalCost);
  });

  const warnEl = document.getElementById('rp-multi-warning');
  if (warnEl){
    warnEl.classList.remove('warn','ok');
    let text = 'Sin advertencias.';
    let cls = 'ok';
    if (state.volumeOrigin > 0 && state.volumeDistributed > state.volumeOrigin + 0.0001){
      text = 'Advertencia: el volumen distribuido excede el volumen origen.';
      cls = 'warn';
    } else if (state.destinations.length && state.volumeOrigin > 0 && state.volumeDistributed > 0){
      text = state.volumeLeft > 0 ? 'Hay volumen sobrante/merma pendiente de distribuir.' : 'Volumen completamente distribuido.';
      cls = state.volumeLeft > 0 ? 'warn' : 'ok';
    }
    warnEl.textContent = text;
    warnEl.classList.add(cls);
  }
  return state;
}

async function reempaqueUpdateActivePreviewPOS(opts){
  return reempaqueGetModePOS() === 'MULTIPLE'
    ? await reempaqueUpdateMultiplePreviewPOS(opts || {})
    : await reempaqueUpdatePreviewPOS(opts || {});
}

function reempaqueClearMultiValidationPOS(){
  ['rp-source-product','rp-source-qty','rp-source-unit-cost','rp-source-total-ml-manual'].forEach(id=>reempaqueSetFieldInvalidPOS(id, false));
  document.querySelectorAll('#rp-multi-destinations .a33-invalid').forEach(el=>el.classList.remove('a33-invalid'));
}

async function registrarReempaqueMultipleUiPOS(){
  reempaqueClearValidationPOS();
  reempaqueClearMultiValidationPOS();
  reempaqueSetMsgPOS('', '');

  const btn = document.getElementById('btn-register-reempaque');
  const state = await reempaqueUpdateMultiplePreviewPOS();
  const errors = [];

  if (!state.eventId) errors.push('Selecciona un evento.');
  if (!state.source){ errors.push('Producto origen requerido.'); reempaqueSetFieldInvalidPOS('rp-source-product', true); }
  if (state.qtySourceInfo.invalid){ errors.push('Cantidad origen inválida.'); reempaqueSetFieldInvalidPOS('rp-source-qty', true); }
  if (!(state.qtySource > 0)){ errors.push('Cantidad origen mayor que 0.'); reempaqueSetFieldInvalidPOS('rp-source-qty', true); }
  if (state.unitCostInfo.invalid || (!state.unitCostInfo.empty && state.unitCostInfo.value < 0)){ errors.push('Costo unitario origen inválido.'); reempaqueSetFieldInvalidPOS('rp-source-unit-cost', true); }
  if (!(state.costOriginTotal > 0)){ errors.push('Costo total origen requerido para distribuir costos.'); reempaqueSetFieldInvalidPOS('rp-source-unit-cost', true); }
  if (state.volumeManualInfo.invalid || (!state.volumeManualInfo.empty && state.volumeManualInfo.value < 0)){ errors.push('Volumen total origen inválido.'); reempaqueSetFieldInvalidPOS('rp-source-total-ml-manual', true); }
  if (!(state.volumeOrigin > 0)){ errors.push('Volumen total origen mayor que 0.'); reempaqueSetFieldInvalidPOS('rp-source-total-ml-manual', true); }
  if (state.stockSource !== null && (state.stockSource + 0.0001) < state.qtySource){
    errors.push('No hay inventario suficiente del producto origen.');
    reempaqueSetFieldInvalidPOS('rp-source-qty', true);
  }
  if (!state.destinations.length) errors.push('Agrega al menos un destino.');

  state.destinations.forEach((d, idx)=>{
    const destNo = idx + 1;
    const destName = d.isNewTarget ? String(d.newTarget && d.newTarget.name || '').trim() : (d.target && d.target.name || '');
    if (d.isNewTarget){
      errors.push(`Destino ${destNo}: Reempaque no puede crear productos. Créalo primero en Catálogos → Productos.`);
      reempaqueSetElementInvalidPOS(d.newNameEl || d.selectEl, true);
    }
    if (!d.target){
      errors.push(`Destino ${destNo}: producto destino requerido.`);
      reempaqueSetElementInvalidPOS(d.isNewTarget ? d.newNameEl : d.selectEl, true);
    }
    if (state.source && d.target){
      const sameId = String(state.source.id) === String(d.target.id);
      const sameName = (typeof normKeyPOS === 'function') && normKeyPOS(state.source.name || '') === normKeyPOS(d.target.name || destName || '');
      if (sameId || sameName){
        errors.push(`Destino ${destNo}: el producto destino no puede ser el mismo origen.`);
        reempaqueSetElementInvalidPOS(d.isNewTarget ? d.newNameEl : d.selectEl, true);
      }
    }
    if (d.qtyInfo.invalid){ errors.push(`Destino ${destNo}: cantidad inválida.`); reempaqueSetElementInvalidPOS(d.qtyEl, true); }
    if (!(d.qty > 0)){ errors.push(`Destino ${destNo}: cantidad destino mayor que 0.`); reempaqueSetElementInvalidPOS(d.qtyEl, true); }
    if (d.mlInfo.invalid){ errors.push(`Destino ${destNo}: ml por unidad inválido.`); reempaqueSetElementInvalidPOS(d.mlEl, true); }
    if (!(d.ml > 0)){ errors.push(`Destino ${destNo}: ml por unidad mayor que 0.`); reempaqueSetElementInvalidPOS(d.mlEl, true); }
    if (d.extraInfo.invalid || (!d.extraInfo.empty && d.extraInfo.value < 0)){
      errors.push(`Destino ${destNo}: costo adicional unitario inválido.`);
      reempaqueSetElementInvalidPOS(d.extraEl, true);
    }
  });

  if (state.volumeOrigin > 0 && state.volumeDistributed > state.volumeOrigin + 0.0001){
    errors.push('El volumen distribuido excede el volumen origen.');
  }
  if (state.destinations.some(d => !Number.isFinite(d.qty) || !Number.isFinite(d.ml) || !Number.isFinite(d.extraUnitCost) || !Number.isFinite(d.volume) || !Number.isFinite(d.liquidUnitCost) || !Number.isFinite(d.liquidTotalCost) || !Number.isFinite(d.extraTotalCost) || !Number.isFinite(d.unitCost) || !Number.isFinite(d.totalCost))){
    errors.push('Hay valores inválidos en los destinos.');
  }
  if (![state.qtySource, state.volumeOrigin, state.costOriginTotal, state.costPerMl, state.volumeDistributed, state.liquidCostDistributed, state.additionalCostTotal, state.costDistributed].every(Number.isFinite)){
    errors.push('Hay valores inválidos en el resumen.');
  }

  if (errors.length){
    reempaqueSetMsgPOS(errors[0], 'warn');
    return;
  }

  try{
    const capacidadOrigenMlPreview = state.sourceUnitMl > 0 ? state.sourceUnitMl : (state.qtySource > 0 ? reempaqueRound4POS(state.volumeOrigin / state.qtySource) : 0);
    const destinosPreview = state.destinations.map(d => ({
      productoDestino: d.target,
      tipoDestino: d.isNewTarget ? 'NUEVO' : 'EXISTENTE',
      destinoTipo: d.isNewTarget ? 'NUEVO' : 'EXISTENTE',
      destinoNuevo: !!d.isNewTarget,
      productoNuevoDestino: !!d.isNewTarget,
      precioVentaDestino: d.isNewTarget ? d.newTarget.price : reempaqueMoneyPOS(d.target && d.target.price),
      cantidadCreada: d.qty,
      cantidadCreadaDestino: d.qty,
      mlPorUnidad: d.ml,
      capacidadDestinoMl: d.ml,
      volumenTotalDestinoMl: d.volume,
      costoLiquidoUnitario: d.liquidUnitCost,
      costoUnitarioLiquido: d.liquidUnitCost,
      costoLiquidoTotal: d.liquidTotalCost,
      costoLiquidoAsignado: d.liquidTotalCost,
      costoAdicionalUnitario: d.extraUnitCost,
      costoEmpaqueUnitario: d.extraUnitCost,
      costoAdicionalTotal: d.extraTotalCost,
      costoEmpaqueTotal: d.extraTotalCost,
      costoUnitarioCalculado: d.unitCost,
      costoUnitarioDestino: d.unitCost,
      costoTotalAsignado: d.totalCost
    }));
    const previewRecord = await reempaquePrepareMultiplePayloadPOS({
      eventId: state.eventId,
      productoOrigen: state.source,
      cantidadOrigen: state.qtySource,
      capacidadOrigenMl: capacidadOrigenMlPreview,
      volumenTotalOrigenMl: state.volumeOrigin,
      costoUnitarioOrigen: state.unitCost,
      costoFuenteOrigen: state.unitCostSource || '',
      costoOrigenTotal: state.costOriginTotal,
      destinos: destinosPreview
    });
    const previewValidation = reempaqueValidateMultipleRecordPOS(previewRecord);
    if (!previewValidation.ok){
      reempaqueSetMsgPOS('No se pudo validar Reempaque múltiple: ' + previewValidation.errors.join(', '), 'warn');
      return;
    }
  }catch(err){
    console.warn('No se pudo prevalidar Reempaque múltiple', err);
    reempaqueSetMsgPOS('No se pudo validar Reempaque múltiple: ' + humanizeError(err), 'warn');
    return;
  }

  const noteEl = document.getElementById('rp-note-multi');
  const note = noteEl ? String(noteEl.value || '').trim() : '';
  const prevTxt = btn ? btn.textContent : '';
  const createdTargetsForRollback = [];
  let movementCompleted = false;
  if (btn){ btn.disabled = true; btn.textContent = 'Registrando…'; }

  try{
    const capacidadOrigenMl = state.sourceUnitMl > 0 ? state.sourceUnitMl : (state.qtySource > 0 ? reempaqueRound4POS(state.volumeOrigin / state.qtySource) : 0);
    const destinosMovimiento = [];
    for (const d of state.destinations){
      if (d.isNewTarget) throw new Error('Reempaque no puede crear productos. Usa Catálogos → Productos.');
      const targetForMovement = await reempaqueEnsureCentralTargetProductPOS(d.target);
      if (!targetForMovement || targetForMovement.id == null){
        throw new Error(`El producto destino ${d.target && d.target.name ? d.target.name : ''} no existe o está inactivo. Usa Catálogos → Productos.`);
      }
      const tipoDestino = 'EXISTENTE';
      const destinoNuevoCreado = false;
      destinosMovimiento.push({
        productoDestino: targetForMovement,
        tipoDestino,
        destinoTipo: tipoDestino,
        destinoNuevo: !!d.isNewTarget,
        productoNuevoDestino: !!d.isNewTarget,
        productoNuevoCreado: destinoNuevoCreado,
        precioVentaDestino: d.isNewTarget ? d.newTarget.price : reempaqueMoneyPOS(targetForMovement && targetForMovement.price),
        cantidadCreada: d.qty,
        cantidadCreadaDestino: d.qty,
        mlPorUnidad: d.ml,
        capacidadDestinoMl: d.ml,
        volumenTotalDestinoMl: d.volume,
        costoLiquidoUnitario: d.liquidUnitCost,
        costoUnitarioLiquido: d.liquidUnitCost,
        costoLiquidoTotal: d.liquidTotalCost,
        costoLiquidoAsignado: d.liquidTotalCost,
        costoAdicionalUnitario: d.extraUnitCost,
        costoEmpaqueUnitario: d.extraUnitCost,
        costoAdicionalTotal: d.extraTotalCost,
        costoEmpaqueTotal: d.extraTotalCost,
        costoUnitarioCalculado: d.unitCost,
        costoUnitarioDestino: d.unitCost,
        costoTotalAsignado: d.totalCost
      });
    }

    const record = await reempaqueApplyMovementPOS({
      eventId: state.eventId,
      productoOrigen: state.source,
      cantidadOrigen: state.qtySource,
      capacidadOrigenMl,
      volumenTotalOrigenMl: state.volumeOrigin,
      costoUnitarioOrigen: state.unitCost,
      costoFuenteOrigen: state.unitCostSource || '',
      costoOrigenTotal: state.costOriginTotal,
      destinos: destinosMovimiento,
      nota: note
    });
    movementCompleted = true;

    const qtySourceEl = document.getElementById('rp-source-qty');
    const volumeEl = document.getElementById('rp-source-total-ml-manual');
    if (qtySourceEl) qtySourceEl.value = '';
    if (volumeEl) volumeEl.value = '';
    if (noteEl) noteEl.value = '';
    const list = document.getElementById('rp-multi-destinations');
    if (list){
      list.innerHTML = '';
      list.appendChild(reempaqueCreateMultiDestinationCardPOS());
    }
    await renderInventario();
    try{ await renderProductos(); }catch(_){ }
    try{ await refreshProductSelect({ keepSelection:true }); }catch(_){ try{ await renderProductChips(); }catch(__){ } }
    try{ await refreshSaleStockLabel(); }catch(_){ }
    reempaqueSetModeUiPOS('MULTIPLE');
    await reempaqueRefreshUiPOS();
    reempaqueSetMsgPOS('Reempaque múltiple registrado.', 'ok');
    toast('Reempaque múltiple registrado');
    return record;
  }catch(err){
    if (!movementCompleted && createdTargetsForRollback.length){
      await reempaqueRollbackCreatedTargetProductsPOS(createdTargetsForRollback);
    }
    console.error('No se pudo registrar Reempaque múltiple', err);
    reempaqueSetMsgPOS('No se pudo registrar Reempaque múltiple: ' + humanizeError(err), 'warn');
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = prevTxt || 'Registrar Reempaque'; }
  }
}


function reempaqueHistoryEventIdFromUiPOS(){
  const evEl = document.getElementById('inv-event');
  const raw = evEl && evEl.value ? String(evEl.value) : '';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : (raw || null);
}

function reempaqueHistoryDatePOS(value){
  const raw = String(value || '').trim();
  if (!raw) return '—';
  try{
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())){
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      return `${y}-${m}-${day} ${hh}:${mm}`;
    }
  }catch(_){ }
  return raw;
}

function reempaqueHistoryHasCapacityTextPOS(name){
  return /(\d+(?:[\.,]\d+)?)\s*(ml|m\.l\.|mililitros?|l|lt|lts|litro|litros)\b/i.test(String(name || ''));
}

function reempaqueHistoryProductLabelPOS(name, capacityMl){
  const base = String(name || '—').trim() || '—';
  const cap = reempaquePositivePOS(capacityMl);
  if (cap > 0 && !reempaqueHistoryHasCapacityTextPOS(base)){
    return `${base} ${reempaqueFmtQtyPOS(cap)} ml`;
  }
  return base;
}

function reempaqueDestinationPartsFromRecordPOS(r){
  const record = r || {};
  const isMulti = reempaqueIsMultipleRecordPOS(record);
  const rawDestinos = Array.isArray(record.destinos) ? record.destinos : (Array.isArray(record.listaDestinos) ? record.listaDestinos : []);
  const out = [];

  if (isMulti && rawDestinos.length){
    rawDestinos.forEach((d, idx)=>{
      const name = d.targetProductName || d.productoDestinoNombre || d.productoDestino || (d.targetProduct && d.targetProduct.name) || `Destino ${idx + 1}`;
      const ml = reempaquePositivePOS(d.mlPorUnidad ?? d.capacidadDestinoMl ?? (d.targetProduct && d.targetProduct.capacityMl));
      const qty = reempaquePositivePOS(d.cantidadCreada ?? d.cantidadCreadaDestino ?? d.cantidadDestino ?? d.targetQty ?? d.qty ?? d.cantidad);
      const volume = reempaquePositivePOS(d.volumenTotalDestinoMl ?? reempaqueTotalVolumePOS(qty, ml));
      const unitCost = reempaqueMoneyPOS(d.costoUnitarioCalculado ?? d.costoUnitarioDestino ?? d.targetUnitCost ?? d.unitCost);
      const totalCost = reempaqueMoneyPOS(d.costoTotalAsignado ?? ((unitCost > 0 && qty > 0) ? unitCost * qty : 0));
      const extraUnitCost = reempaqueMoneyPOS(d.costoAdicionalUnitario ?? d.costoEmpaqueUnitario ?? d.extraUnitCost ?? d.additionalUnitCost ?? 0);
      const extraTotalCost = reempaqueMoneyPOS(d.costoAdicionalTotal ?? d.costoEmpaqueTotal ?? (extraUnitCost > 0 && qty > 0 ? extraUnitCost * qty : 0));
      const liquidTotalCost = reempaqueMoneyPOS(d.costoLiquidoTotal ?? d.costoLiquidoAsignado ?? Math.max(0, totalCost - extraTotalCost));
      const liquidUnitCost = reempaqueMoneyPOS(d.costoLiquidoUnitario ?? d.costoUnitarioLiquido ?? (qty > 0 && liquidTotalCost > 0 ? liquidTotalCost / qty : Math.max(0, unitCost - extraUnitCost)));
      const tipoDestinoRaw = String(d.tipoDestino ?? d.destinoTipo ?? (d.productoNuevoCreado ? 'NUEVO' : (d.destinoNuevo || d.productoNuevoDestino ? 'NUEVO' : 'EXISTENTE'))).toUpperCase();
      const tipoDestino = (tipoDestinoRaw === 'NUEVO' || tipoDestinoRaw === 'NUEVO_EXISTENTE') ? tipoDestinoRaw : 'EXISTENTE';
      out.push({
        index: idx,
        name: String(name || `Destino ${idx + 1}`).trim(),
        label: reempaqueHistoryProductLabelPOS(name, ml),
        tipoDestino,
        destinoNuevo: !!(d.destinoNuevo || d.productoNuevoDestino || tipoDestino === 'NUEVO' || tipoDestino === 'NUEVO_EXISTENTE'),
        productoNuevoCreado: !!(d.productoNuevoCreado || tipoDestino === 'NUEVO'),
        precioVentaDestino: reempaqueMoneyPOS(d.precioVentaDestino ?? d.precioDestino ?? 0),
        qty,
        ml,
        volume,
        liquidUnitCost,
        liquidTotalCost,
        extraUnitCost,
        extraTotalCost,
        unitCost,
        totalCost
      });
    });
    return out;
  }

  const name = record.targetProductName || record.productoDestinoNombre || record.productoDestino || (record.targetProduct && record.targetProduct.name) || '—';
  const ml = reempaquePositivePOS(record.capacidadDestinoMl ?? (record.targetProduct && record.targetProduct.capacityMl));
  const qty = reempaquePositivePOS(record.cantidadFinalRegistrada ?? record.cantidadCreadaDestino ?? record.cantidadDestino ?? record.targetQty);
  const volume = reempaquePositivePOS(record.volumenTotalDestinoMl ?? reempaqueTotalVolumePOS(qty, ml));
  const unitCost = reempaqueMoneyPOS(record.costoUnitarioDestino ?? record.targetUnitCost);
  const totalCost = reempaqueMoneyPOS(record.costoTotalReempaque ?? (unitCost > 0 && qty > 0 ? unitCost * qty : 0));
  const extraTotalCost = reempaqueMoneyPOS(record.costoAdicionalTotal ?? record.costoEmpaqueTotal ?? record.extraCostTotal ?? 0);
  const extraUnitCost = reempaqueMoneyPOS(record.costoAdicionalUnitario ?? record.costoEmpaqueUnitario ?? ((qty > 0 && extraTotalCost > 0) ? extraTotalCost / qty : 0));
  const liquidTotalCost = reempaqueMoneyPOS(record.costoLiquidoTotal ?? record.costoOrigenTotal ?? record.costoTotalOrigen ?? Math.max(0, totalCost - extraTotalCost));
  const liquidUnitCost = reempaqueMoneyPOS(record.costoLiquidoUnitario ?? record.costoUnitarioLiquido ?? (qty > 0 && liquidTotalCost > 0 ? liquidTotalCost / qty : Math.max(0, unitCost - extraUnitCost)));
  return [{ index:0, name:String(name || '—').trim(), label:reempaqueHistoryProductLabelPOS(name, ml), tipoDestino:'EXISTENTE', destinoNuevo:false, productoNuevoCreado:false, precioVentaDestino:0, qty, ml, volume, liquidUnitCost, liquidTotalCost, extraUnitCost, extraTotalCost, unitCost, totalCost }];
}

function reempaqueHistoryRecordPartsPOS(r){
  r = r || {};
  const destinos = reempaqueDestinationPartsFromRecordPOS(r);
  const isMulti = reempaqueIsMultipleRecordPOS(r) || destinos.length > 1;
  const srcName = r.sourceProductName || r.productoOrigenNombre || r.productoOrigen || (r.sourceProduct && r.sourceProduct.name) || '—';
  const srcCap = r.capacidadOrigenMl ?? (r.sourceProduct && r.sourceProduct.capacityMl);
  const qtySrc = reempaquePositivePOS(r.cantidadOrigen ?? r.sourceQty ?? r.qtyOrigen);
  const eventName = String(r.eventName || r.nombreEvento || r.eventCode || r.eventoCodigo || r.eventId || 'Evento').trim();
  const volumenOrigen = reempaquePositivePOS(r.volumenTotalOrigenMl ?? reempaqueTotalVolumePOS(qtySrc, srcCap));
  const volumenDestino = reempaquePositivePOS(r.volumenTotalDestinoMl ?? destinos.reduce((a,d)=>a + reempaquePositivePOS(d.volume), 0));
  const mermaMl = reempaquePositivePOS(r.mlSobranteMerma ?? (r.merma && r.merma.ml) ?? (r.sobranteMerma && r.sobranteMerma.ml) ?? (volumenOrigen > volumenDestino ? volumenOrigen - volumenDestino : 0));
  const mermaCosto = reempaqueMoneyPOS(r.costoSobranteMerma ?? (r.merma && r.merma.costo) ?? (r.sobranteMerma && r.sobranteMerma.costo));
  const destinoNames = destinos.map(d => d.name).filter(Boolean);
  const destinoResumen = isMulti
    ? (destinoNames.length ? destinoNames.join(' + ') : (r.destinoResumen || 'Múltiples destinos'))
    : ((destinos[0] && destinos[0].label) || '—');
  const destinoDetalle = destinos.map(d => {
    const qty = reempaqueFmtQtyPOS(d.qty || 0);
    const name = d.label || d.name || 'Destino';
    const ml = d.ml > 0 ? `${reempaqueFmtQtyPOS(d.ml)} ml c/u` : 'ml N/D';
    const liquid = reempaqueFmtMoneyPOS(d.liquidUnitCost);
    const extra = reempaqueFmtMoneyPOS(d.extraUnitCost, reempaqueFormatCordobasPOS(0));
    const unit = reempaqueFmtMoneyPOS(d.unitCost);
    const total = reempaqueFmtMoneyPOS(d.totalCost);
    const volume = d.volume > 0 ? `${reempaqueFmtQtyPOS(d.volume)} ml` : 'volumen N/D';
    const tipo = reempaqueDescribeDestinationKindPOS(d.tipoDestino);
    const price = d.precioVentaDestino > 0 ? `, precio venta ${reempaqueFmtMoneyPOS(d.precioVentaDestino)}` : '';
    return `${name}: ${tipo}, ${qty} unidades, ${ml}, ${volume}, costo líquido unitario ${liquid}, adicional unitario ${extra}, costo final unitario ${unit}, costo total ${total}${price}`;
  });

  return {
    id: String(r.id || ''),
    fecha: reempaqueHistoryDatePOS(r.fechaHora || r.createdAt || r.date || r.updatedAt),
    evento: eventName || 'Evento',
    origen: reempaqueHistoryProductLabelPOS(srcName, srcCap),
    origenNombre: String(srcName || '—'),
    destino: destinoResumen,
    destinoDetalle,
    destinos,
    qtyOrigen: qtySrc,
    qtyDestino: reempaqueRound4POS(destinos.reduce((a,d)=> a + reempaquePositivePOS(d.qty), 0)),
    capacidadOrigen: reempaquePositivePOS(srcCap),
    capacidadDestino: destinos.length === 1 ? reempaquePositivePOS(destinos[0].ml) : 0,
    volumenOrigen,
    volumenDestino,
    sugerida: reempaquePositivePOS(r.cantidadSugeridaPorVolumen),
    final: reempaqueRound4POS(destinos.reduce((a,d)=> a + reempaquePositivePOS(d.qty), 0)),
    costoOrigen: reempaqueMoneyPOS(r.costoOrigenTotal ?? r.costoTotalOrigen),
    costoAdicional: reempaqueMoneyPOS(r.costoAdicionalTotal ?? r.costoAdicionalDestinos ?? destinos.reduce((a,d)=> a + reempaqueMoneyPOS(d.extraTotalCost), 0)),
    costoTotal: reempaqueMoneyPOS(r.costoTotalReempaque ?? r.costoTotalFinalDestinos ?? r.costoTotalDistribuido),
    costoPorMl: reempaquePositivePOS(r.costoPorMl),
    costoUnitarioDestino: destinos.length === 1 ? reempaqueMoneyPOS(destinos[0].unitCost) : 0,
    nota: String(r.nota || r.note || '').trim(),
    multiple: isMulti,
    mermaMl,
    mermaCosto
  };
}

async function renderReempaqueHistoryPOS(eventId){
  const wrap = document.getElementById('rp-history-list');
  const countEl = document.getElementById('rp-history-count');
  if (!wrap) return;
  const eid = eventId || reempaqueHistoryEventIdFromUiPOS();
  if (!eid){
    wrap.innerHTML = '<div class="reempaque-empty muted">Selecciona un evento para ver el historial.</div>';
    if (countEl) countEl.textContent = '0 registros';
    return;
  }
  let rows = [];
  try{ rows = await reempaqueLoadForEventPOS(eid); }catch(e){ console.warn('No se pudo cargar historial de Reempaque', e); rows = []; }
  const total = Array.isArray(rows) ? rows.length : 0;
  if (countEl) countEl.textContent = total === 1 ? '1 registro' : `${total} registros`;
  if (!total){
    wrap.innerHTML = '<div class="reempaque-empty muted">Sin Reempaques registrados para este evento.</div>';
    return;
  }
  const limited = rows.slice(0, 12);
  const cards = limited.map(r => {
    const p = reempaqueHistoryRecordPartsPOS(r || {});
    const modeLabel = p.multiple ? 'Múltiple' : 'Simple';
    const summary = `${p.origen} → ${p.destino}`;
    const destinosHtml = (p.destinoDetalle || []).map((line, idx)=>
      `<span class="reempaque-history-wide"><strong>Destino ${idx + 1}:</strong> ${escapeHtml(line)}</span>`
    ).join('');
    const mermaTxt = `${p.mermaMl > 0 ? reempaqueFmtMlPOS(p.mermaMl) : '0 ml'} / ${reempaqueFmtMoneyPOS(p.mermaCosto, reempaqueFormatCordobasPOS(0))}`;
    return `
      <article class="reempaque-history-item">
        <div class="reempaque-history-main">
          <b>${escapeHtml(summary)}</b>
          <small>${escapeHtml(p.evento)} · ${escapeHtml(p.fecha)} · ${escapeHtml(modeLabel)}</small>
        </div>
        <div class="reempaque-history-meta">
          <span><strong>Evento:</strong> ${escapeHtml(p.evento)}</span>
          <span><strong>Fecha/hora:</strong> ${escapeHtml(p.fecha)}</span>
          <span><strong>Tipo:</strong> ${escapeHtml(modeLabel)}</span>
          <span><strong>Origen:</strong> ${escapeHtml(p.origen)}</span>
          <span><strong>Cantidad origen:</strong> ${escapeHtml(reempaqueFmtQtyPOS(p.qtyOrigen))}</span>
          <span><strong>Volumen origen:</strong> ${escapeHtml(reempaqueFmtMlPOS(p.volumenOrigen))}</span>
          <span><strong>Costo origen:</strong> ${escapeHtml(reempaqueFmtMoneyPOS(p.costoOrigen))}</span>
          <span><strong>Volumen distribuido:</strong> ${escapeHtml(reempaqueFmtMlPOS(p.volumenDestino))}</span>
          <span><strong>Sobrante/merma:</strong> ${escapeHtml(mermaTxt)}</span>
          ${destinosHtml}
          <span class="reempaque-history-wide"><strong>Nota:</strong> ${escapeHtml(p.nota || '—')}</span>
        </div>
      </article>`;
  }).join('');
  const more = total > limited.length ? `<div class="reempaque-empty muted">Mostrando últimos ${limited.length} de ${total} registros.</div>` : '';
  wrap.innerHTML = cards + more;
}

async function reempaqueBuildExportRowsPOS(eventId){
  const rows = [[
    'Fecha',
    'Evento',
    'Modo',
    'ID Reempaque',
    'Producto origen',
    'Cantidad origen',
    'ml origen/unidad',
    'Volumen origen total ml',
    'Costo origen total',
    'Costo por ml',
    'Producto destino',
    'Tipo destino',
    'Cantidad destino',
    'ml por unidad destino',
    'Volumen destino total ml',
    'Costo líquido unitario',
    'Costo líquido total',
    'Costo adicional unitario',
    'Costo adicional total',
    'Costo unitario destino final',
    'Costo total asignado final',
    'Volumen distribuido total ml',
    'Sobrante/merma ml',
    'Costo sobrante/merma',
    'Nota'
  ]];
  let records = [];
  try{ records = await reempaqueLoadForEventPOS(eventId); }catch(_){ records = []; }
  for (const r of (records || []).slice().reverse()){
    const p = reempaqueHistoryRecordPartsPOS(r || {});
    const dests = p.destinos && p.destinos.length ? p.destinos : [{ name:p.destino, qty:p.qtyDestino, ml:p.capacidadDestino, volume:0, unitCost:p.costoUnitarioDestino, totalCost:p.costoTotal }];
    for (const d of dests){
      rows.push([
        p.fecha,
        p.evento,
        p.multiple ? 'Múltiple' : 'Simple',
        p.id || '',
        p.origen,
        p.qtyOrigen || 0,
        p.capacidadOrigen || '',
        p.volumenOrigen || '',
        p.costoOrigen || 0,
        p.costoPorMl || '',
        d.label || d.name || '',
        reempaqueDescribeDestinationKindPOS(d.tipoDestino),
        d.qty || 0,
        d.ml || '',
        d.volume || '',
        d.liquidUnitCost || 0,
        d.liquidTotalCost || 0,
        d.extraUnitCost || 0,
        d.extraTotalCost || 0,
        d.unitCost || 0,
        d.totalCost || 0,
        p.volumenDestino || '',
        p.mermaMl || 0,
        p.mermaCosto || 0,
        p.nota || ''
      ]);
    }
  }
  return rows;
}

async function reempaqueRefreshUiPOS(){
  if (!document.getElementById('reempaque-block')) return;
  reempaqueSetModeUiPOS(reempaqueGetModePOS());
  const products = await reempaquePopulateSelectorsPOS();
  const registerBtn = document.getElementById('btn-register-reempaque');
  if (registerBtn) registerBtn.disabled = products.length === 0;
  if (!products.length){
    reempaqueSetMsgPOS('No hay productos activos. Créelos primero en Gestión Operativa → Catálogos → Productos.', 'warn');
  }
  await reempaqueUpdateActivePreviewPOS({ products });
  await renderReempaqueHistoryPOS(reempaqueHistoryEventIdFromUiPOS());
}

function reempaqueClearValidationPOS(){
  ['rp-source-product','rp-source-qty','rp-source-unit-cost','rp-source-total-ml-manual','rp-target-product','rp-target-qty','rp-extra-cost','rp-new-target-name','rp-new-target-capacity','rp-new-target-price'].forEach(id=>reempaqueSetFieldInvalidPOS(id, false));
  try{ reempaqueClearMultiValidationPOS(); }catch(_){ }
}

async function registrarReempaqueUiPOS(){
  if (reempaqueGetModePOS() === 'MULTIPLE') return await registrarReempaqueMultipleUiPOS();
  reempaqueClearValidationPOS();
  reempaqueSetMsgPOS('', '');

  const btn = document.getElementById('btn-register-reempaque');
  const evEl = document.getElementById('inv-event');
  const eventId = evEl && evEl.value ? parseInt(evEl.value, 10) : 0;
  const state = await reempaqueUpdatePreviewPOS();
  const errors = [];

  if (!eventId) errors.push('Selecciona un evento.');
  if (!state.source){ errors.push('Producto origen requerido.'); reempaqueSetFieldInvalidPOS('rp-source-product', true); }
  if (!(state.qtySource > 0)){ errors.push('Cantidad origen mayor que 0.'); reempaqueSetFieldInvalidPOS('rp-source-qty', true); }
  if (!state.target){
    errors.push('Selecciona un producto destino activo. Si no existe, créalo primero en Catálogos → Productos.');
    reempaqueSetFieldInvalidPOS('rp-target-product', true);
  }
  if (!(state.qtyTarget > 0)){ errors.push('Cantidad creada mayor que 0.'); reempaqueSetFieldInvalidPOS('rp-target-qty', true); }
  if (state.extraCostInfo && (state.extraCostInfo.invalid || (!state.extraCostInfo.empty && state.extraCostInfo.value < 0))){
    errors.push('Costo adicional unitario inválido.');
    reempaqueSetFieldInvalidPOS('rp-extra-cost', true);
  }
  if (state.source && state.target && (String(state.source.id) === String(state.target.id) || ((typeof normKeyPOS === 'function') && normKeyPOS(state.source.name || '') === normKeyPOS(state.target.name || '')))){
    errors.push('El producto origen y destino no deberían ser el mismo.');
    reempaqueSetFieldInvalidPOS('rp-source-product', true);
    reempaqueSetFieldInvalidPOS('rp-target-product', true);
  }

  if (errors.length){ reempaqueSetMsgPOS(errors[0], 'warn'); return; }

  const verifiedTarget = await reempaqueEnsureCentralTargetProductPOS(state.target);
  if (!verifiedTarget){
    reempaqueSetFieldInvalidPOS('rp-target-product', true);
    reempaqueSetMsgPOS('El producto destino ya no existe o está inactivo. Créalo o actívalo en Catálogos → Productos.', 'warn');
    return;
  }

  const noteEl = document.getElementById('rp-note');
  const note = noteEl ? String(noteEl.value || '').trim() : '';
  const prevTxt = btn ? btn.textContent : '';
  if (btn){ btn.disabled = true; btn.textContent = 'Registrando…'; }

  try{
    const record = await reempaqueApplyMovementPOS({
      eventId,
      productoOrigen: state.source,
      productoDestino: verifiedTarget,
      cantidadOrigen: state.qtySource,
      cantidadCreadaDestino: state.qtyTarget,
      cantidadFinalRegistrada: state.qtyTarget,
      costoUnitarioOrigen: state.unitCost > 0 ? state.unitCost : 0,
      costoFuenteOrigen: state.unitCostSource || '',
      costoOrigenTotal: state.costOriginTotal > 0 ? state.costOriginTotal : 0,
      costoLiquidoTotal: state.costOriginTotal > 0 ? state.costOriginTotal : 0,
      costoLiquidoUnitario: state.liquidUnitTarget > 0 ? state.liquidUnitTarget : 0,
      costoAdicionalUnitario: state.costAdditionalUnit > 0 ? state.costAdditionalUnit : 0,
      costoAdicionalTotal: state.costAdditionalTotal > 0 ? state.costAdditionalTotal : 0,
      costoTotalReempaque: state.costTotal > 0 ? state.costTotal : 0,
      costoUnitarioDestino: state.unitTarget > 0 ? state.unitTarget : 0,
      nota: note
    });
    const qtySourceEl = document.getElementById('rp-source-qty');
    const qtyTargetEl = document.getElementById('rp-target-qty');
    const extraCostEl = document.getElementById('rp-extra-cost');
    if (qtySourceEl) qtySourceEl.value = '';
    if (qtyTargetEl){ qtyTargetEl.value = ''; delete qtyTargetEl.dataset.rpqAuto; }
    if (extraCostEl) extraCostEl.value = '';
    if (noteEl) noteEl.value = '';
    await renderInventario();
    try{ await refreshProductSelect({ keepSelection:true }); }catch(_){ try{ await renderProductChips(); }catch(__){ } }
    try{ await refreshSaleStockLabel(); }catch(_){ }
    reempaqueSetMsgPOS('Reempaque registrado.', 'ok');
    toast('Reempaque registrado');
    return record;
  }catch(err){
    console.error('No se pudo registrar Reempaque', err);
    reempaqueSetMsgPOS('No se pudo registrar Reempaque: ' + humanizeError(err), 'warn');
  }finally{
    if (btn){ btn.disabled = false; btn.textContent = prevTxt || 'Registrar Reempaque'; }
  }
}

// Inventario UI
async function renderInventario(){
  const tbody = $('#tbl-inv tbody');
  if (!tbody) return;
  tbody.innerHTML='';

  const evSel = $('#inv-event');
  let evId = evSel && evSel.value ? parseInt(evSel.value,10) : null;
  if (!evId){
    const evs = await getAll('events');
    if (evs.length) evId = evs[0].id;
    if (evSel && evId) evSel.value = evId;
  }
  if (!evId){
    // Limpia el historial de Reempaque para evitar datos viejos
    try{ await renderReempaqueHistoryPOS(null); }catch(_){ }

    // Limpia el bloque informativo de lotes para evitar datos viejos
    const ltBody = $('#tbl-lotes-evento tbody');
    const badge = $('#lotes-count');
    if (ltBody) ltBody.innerHTML = '<tr><td colspan="7"><small class="muted">No hay eventos.</small></td></tr>';
    if (badge) badge.textContent = '0';

    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="8">No hay eventos. Crea uno en la pestaña Vender.</td>';
    tbody.appendChild(tr);
    return;
  }

  // Bloque informativo: lotes cargados en este evento
  await renderLotesCargadosEvento(evId);

  // UI: Sobrantes → Lote hijo (solo UI; no altera inventario)
  try{ await refreshSobranteUIForEventPOS(evId); }catch(e){ console.warn('refreshSobranteUIForEventPOS error', e); }

  // UI: Reverso de asignación (airbag anti-errores)
  try{ await refreshReversoUIForEventPOS(evId); }catch(e){ console.warn('refreshReversoUIForEventPOS error', e); }

  // UI: Reempaque genérico (movimiento interno de inventario; no ventas ni caja)
  try{ await reempaqueRefreshUiPOS(); }catch(e){ console.warn('reempaqueRefreshUiPOS error', e); }

  const prods = await getAll('products');
  const hiddenIds = await getHiddenProductIdsPOS();
  for (const p of prods){
    if (hiddenIds.has(p.id)) continue;
    const st = await computeStock(evId, p.id);
    const init = await getInventoryInit(evId, p.id);
    const disabled = (p.manageStock===false) ? 'disabled' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.name}</td>
      <td><input type="checkbox" class="inv-active" data-id="${p.id}" ${p.active===false?'':'checked'} disabled title="Administra Activo en Catálogos → Productos"></td>
      <td><input type="checkbox" class="inv-manage" data-id="${p.id}" ${p.manageStock===false?'':'checked'} disabled title="Administra Manejar inventario en Catálogos → Productos"></td>
      <td><input class="inv-inicial a33-num" data-a33-default="${init?init.qty:0}" data-id="${p.id}" type="number" inputmode="numeric" step="1" value="${init?init.qty:0}" ${disabled}></td>
      <td><input class="inv-repo" data-id="${p.id}" type="number" inputmode="numeric" step="1" placeholder="+" ${disabled}></td>
      <td><input class="inv-ajuste" data-id="${p.id}" type="number" inputmode="numeric" step="1" placeholder="+/-" ${disabled}></td>
      <td><span class="stockpill ${st<=0?'low':''}">${st}</span></td>
      <td class="actions">
        <button class="act-guardar-inicial" data-id="${p.id}" ${disabled}>Guardar inicial</button>
        <button class="act-reponer" data-id="${p.id}" ${disabled}>Reponer</button>
        <button class="act-ajustar" data-id="${p.id}" ${disabled}>Ajustar</button>
      </td>
    `;
    if (p.manageStock===false) tr.classList.add('dim');
    tbody.appendChild(tr);
  }
}

// Inventario: listeners
document.addEventListener('click', async (e)=>{
  if (e.target.classList.contains('act-guardar-inicial')){
    const pid = parseInt(e.target.dataset.id,10);
    const evId = parseInt($('#inv-event').value||'0',10);
    const tr = e.target.closest('tr');
    const qty = parseInt(tr.querySelector('.inv-inicial').value||'0',10);
    await setInitialStock(evId, pid, isNaN(qty)?0:qty);
    await renderInventario(); await refreshSaleStockLabel();
    toast('Inicial guardado');
  }
  if (e.target.classList.contains('act-reponer')){
    const pid = parseInt(e.target.dataset.id,10);
    const evId = parseInt($('#inv-event').value||'0',10);
    const tr = e.target.closest('tr');
    const qty = parseInt(tr.querySelector('.inv-repo').value||'0',10);
    if (!(qty>0)) { alert('Ingresa una reposición > 0'); return; }
    await addRestock(evId, pid, qty);
    tr.querySelector('.inv-repo').value='';
    await renderInventario(); await refreshSaleStockLabel();
    toast('Reposición agregada');
  }
  if (e.target.classList.contains('act-ajustar')){
    const pid = parseInt(e.target.dataset.id,10);
    const evId = parseInt($('#inv-event').value||'0',10);
    const tr = e.target.closest('tr');
    const qty = parseInt(tr.querySelector('.inv-ajuste').value||'0',10);
    if (!qty) { alert('Ingresa un ajuste (positivo o negativo)'); return; }
    await addAdjust(evId, pid, qty, 'Ajuste manual');
    tr.querySelector('.inv-ajuste').value='';
    await renderInventario(); await refreshSaleStockLabel();
    toast('Ajuste registrado');
  }
});

document.addEventListener('change', async (e)=>{
  if (e.target.classList.contains('inv-manage') || e.target.classList.contains('inv-active')){
    e.preventDefault();
    await renderInventario();
    toast('Propiedad de Producto bloqueada: usa Catálogos → Productos');
  }
});


// Reempaque UI: eventos delegados (POS > Inventario)
document.addEventListener('click', async (e)=>{
  const t = e.target;
  if (!t) return;
  if (t.id === 'btn-toggle-reempaque'){
    reempaqueSetOpenPOS(!reempaqueIsOpenPOS());
  }
  if (t.id === 'btn-register-reempaque'){
    await registrarReempaqueUiPOS();
  }
  if (t.id === 'btn-rp-add-destination'){
    await reempaqueAddMultiDestinationRowPOS();
    reempaqueClearValidationPOS();
    reempaqueSetMsgPOS('', '');
  }
  if (t.classList && t.classList.contains('rp-multi-remove')){
    reempaqueRemoveMultiDestinationRowPOS(t);
    await reempaqueUpdateMultiplePreviewPOS();
    reempaqueClearValidationPOS();
    reempaqueSetMsgPOS('', '');
  }
});

document.addEventListener('change', async (e)=>{
  const t = e.target;
  if (!t) return;
  if (t.name === 'rp-mode'){
    reempaqueSetModeUiPOS(t.value);
    await reempaqueRefreshUiPOS();
    reempaqueClearValidationPOS();
    reempaqueSetMsgPOS('', '');
  }
  if (t.id === 'rp-source-product' || t.id === 'rp-target-product'){
    const qtyTargetEl = document.getElementById('rp-target-qty');
    const unitCostEl = document.getElementById('rp-source-unit-cost');
    if (qtyTargetEl) qtyTargetEl.dataset.rpqAuto = '1';
    if (unitCostEl && t.id === 'rp-source-product') unitCostEl.dataset.rpqAutoCost = '1';
    await reempaqueUpdateActivePreviewPOS();
    reempaqueClearValidationPOS();
    reempaqueSetMsgPOS('', '');
  }
  if (t.classList && t.classList.contains('rp-multi-target-product')){
    const card = t.closest('.reempaque-dest-card');
    const mlEl = card ? card.querySelector('.rp-multi-target-ml') : null;
    if (mlEl) mlEl.dataset.rpqAuto = '1';
    await reempaqueUpdateMultiplePreviewPOS();
    reempaqueClearValidationPOS();
    reempaqueSetMsgPOS('', '');
  }
  if (t.classList && t.classList.contains('rp-multi-target-kind')){
    const card = t.closest('.reempaque-dest-card');
    reempaqueApplyMultiDestinationKindUiPOS(card);
    const mlEl = card ? card.querySelector('.rp-multi-target-ml') : null;
    if (mlEl) mlEl.dataset.rpqAuto = '1';
    await reempaqueUpdateMultiplePreviewPOS();
    reempaqueClearValidationPOS();
    reempaqueSetMsgPOS('', '');
  }
});

document.addEventListener('input', async (e)=>{
  const t = e.target;
  if (!t) return;
  if (t.id === 'rp-target-qty'){
    t.dataset.rpqAuto = '0';
    await reempaqueUpdateActivePreviewPOS();
  } else if (t.id === 'rp-source-qty' || t.id === 'rp-extra-cost' || t.id === 'rp-source-total-ml-manual'){
    await reempaqueUpdateActivePreviewPOS();
  } else if (t.id === 'rp-source-unit-cost'){
    t.dataset.rpqAutoCost = '0';
    await reempaqueUpdateActivePreviewPOS();
  } else if (t.id === 'rp-new-target-name' || t.id === 'rp-new-target-capacity' || t.id === 'rp-new-target-price'){
    const qtyTargetEl = document.getElementById('rp-target-qty');
    if (qtyTargetEl) qtyTargetEl.dataset.rpqAuto = '1';
    await reempaqueUpdateActivePreviewPOS();
  } else if (t.classList && t.classList.contains('rp-multi-target-qty')){
    await reempaqueUpdateMultiplePreviewPOS();
  } else if (t.classList && t.classList.contains('rp-multi-target-ml')){
    t.dataset.rpqAuto = '0';
    await reempaqueUpdateMultiplePreviewPOS();
  } else if (t.classList && t.classList.contains('rp-multi-extra-unit-cost')){
    await reempaqueUpdateMultiplePreviewPOS();
  } else if (t.classList && (t.classList.contains('rp-multi-new-target-name') || t.classList.contains('rp-multi-new-target-capacity') || t.classList.contains('rp-multi-new-target-price'))){
    const card = t.closest('.reempaque-dest-card');
    const mlEl = card ? card.querySelector('.rp-multi-target-ml') : null;
    if (mlEl && (t.classList.contains('rp-multi-new-target-name') || t.classList.contains('rp-multi-new-target-capacity'))) mlEl.dataset.rpqAuto = '1';
    await reempaqueUpdateMultiplePreviewPOS();
  }
  if (t.id === 'rp-source-qty' || t.id === 'rp-target-qty' || t.id === 'rp-source-unit-cost' || t.id === 'rp-extra-cost' || t.id === 'rp-source-total-ml-manual' || t.id === 'rp-new-target-name' || t.id === 'rp-new-target-capacity' || t.id === 'rp-new-target-price' || (t.classList && (t.classList.contains('rp-multi-target-qty') || t.classList.contains('rp-multi-target-ml') || t.classList.contains('rp-multi-extra-unit-cost') || t.classList.contains('rp-multi-new-target-name') || t.classList.contains('rp-multi-new-target-capacity') || t.classList.contains('rp-multi-new-target-price')))){
    reempaqueClearValidationPOS();
    reempaqueSetMsgPOS('', '');
  }
});

// Day list filtered by current event
async function renderDay(){
  try {
    const d = $('#sale-date').value;
    const curId = await getMeta('currentEventId');
    const tbody = $('#tbl-day tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!curId){ 
      $('#day-total').textContent = fmt(0); 
      return; 
    }
    const allSales = await getAll('sales');
    const banks = await getAllBanksSafe();
    const bankMap = new Map();
    for (const b of banks){
      if (b && b.id != null) bankMap.set(Number(b.id), b.name || '');
    }
    const filtered = allSales.filter(s => s.eventId === curId && s.date === d);
    let total = 0;
    // Más reciente primero
    filtered.sort((a,b)=> (saleSortKeyPOS(b) - saleSortKeyPOS(a)));
    for (const s of filtered){
      total += Number(s.total || 0);
      const payKey = normalizePaymentMethodPOS(s.payment || '');
      const payClass = payKey === 'efectivo'
        ? 'pay-ef'
        : (payKey === 'transferencia' ? 'pay-tr' : (payKey === 'tarjeta' ? 'pay-card' : 'pay-cr'));
      const payTxt = getSalePaymentLabelPOS(s, bankMap);
      const tenderDetail = getSaleCashTenderDetailTextPOS(s);
      const tr = document.createElement('tr');
      const seqTxt = getSaleSeqDisplayPOS(s);
      const timeTxt = getSaleTimeTextPOS(s);
      tr.innerHTML = `<td>${seqTxt ? ('#' + seqTxt + ' · ') : ''}${timeTxt}</td>
        <td>${escapeHtml(uiProductNamePOS(s.productName))}</td>
        <td>${s.qty}</td>
        <td>${fmt(s.unitPrice)}</td>
        <td>${fmt(getSaleDiscountTotalPOS(s))}</td>
        <td>${fmt(s.total)}</td>
        <td><span class="tag ${payClass}" title="${escapeHtml(tenderDetail)}">${payTxt}</span>${tenderDetail ? `<div class="muted"><small>${escapeHtml(tenderDetail)}</small></div>` : ''}</td>
        <td>${s.courtesy?'✓':''}</td>
        <td>${s.isReturn?'✓':''}</td>
        <td>${escapeHtml(getSaleCustomerSnapshotNamePOS(s))}</td>
        <td>${s.courtesyTo||''}</td>
        <td><button data-id="${s.id}" title="Eliminar venta" class="btn-danger btn-mini del-sale">Eliminar</button></td>`;
      tbody.appendChild(tr);
    }
    $('#day-total').textContent = fmt(total);
  } catch (e) {
    console.error('Error en renderDay', e);
    const tbody = $('#tbl-day tbody');
    if (tbody) tbody.innerHTML = '';
    $('#day-total').textContent = fmt(0);
  }
}

// Summary (extendido con costo y utilidad)

// --- Resumen: filtro por Cliente (POS) ---
const POS_SUMMARY_CUSTOMER_FILTER_KEY = 'pos_summary_customer_filter_v1';

function normalizeSummaryCustomerFilterPOS(obj){
  if (!obj || typeof obj !== 'object') return null;
  const type = (obj.type === 'id' || obj.type === 'name') ? obj.type : '';
  const value = (obj.value != null) ? String(obj.value).trim() : '';
  if (!type || !value) return null;
  const displayName = (obj.displayName != null) ? sanitizeCustomerDisplayPOS(obj.displayName) : '';
  return { type, value, displayName };
}

function getSummaryCustomerFilterPOS(){
  try{
    if (typeof window !== 'undefined' && window.__A33_SUMMARY_CUSTOMER_FILTER){
      const n = normalizeSummaryCustomerFilterPOS(window.__A33_SUMMARY_CUSTOMER_FILTER);
      if (n) return n;
    }
  }catch(_){ }

  let stored = null;
  try{ stored = A33Storage.getJSON(POS_SUMMARY_CUSTOMER_FILTER_KEY, null, 'local'); }catch(_){ stored = null; }
  const n = normalizeSummaryCustomerFilterPOS(stored);
  try{ if (typeof window !== 'undefined') window.__A33_SUMMARY_CUSTOMER_FILTER = n; }catch(_){ }
  return n;
}

function setSummaryCustomerFilterPOS(filter, { silentUI = false } = {}){
  const n = normalizeSummaryCustomerFilterPOS(filter);
  try{ if (typeof window !== 'undefined') window.__A33_SUMMARY_CUSTOMER_FILTER = n; }catch(_){ }
  try{ A33Storage.setJSON(POS_SUMMARY_CUSTOMER_FILTER_KEY, n, 'local'); }catch(_){ }
  if (!silentUI) syncSummaryCustomerFilterUI_POS(n);
  return n;
}

function clearSummaryCustomerFilterPOS({ silentUI = false } = {}){
  try{ if (typeof window !== 'undefined') window.__A33_SUMMARY_CUSTOMER_FILTER = null; }catch(_){ }
  try{ A33Storage.setJSON(POS_SUMMARY_CUSTOMER_FILTER_KEY, null, 'local'); }catch(_){ }
  if (!silentUI) syncSummaryCustomerFilterUI_POS(null);
}

function syncSummaryCustomerFilterUI_POS(filter, resolver){
  const inp = document.getElementById('summary-customer');
  const badge = document.getElementById('summary-customer-badge');

  // Input
  if (inp){
    if (!filter){
      inp.value = '';
      try{ if (inp.dataset) delete inp.dataset.customerId; }catch(_){ }
    } else if (filter.type === 'id'){
      const fid = String(filter.value || '').trim();
      const dn = resolver ? (resolver.getDisplayName(fid) || filter.displayName || '') : (filter.displayName || '');
      if (dn) inp.value = dn;
      try{ if (inp.dataset) inp.dataset.customerId = fid; }catch(_){ }
    } else {
      // type=name
      try{ if (inp.dataset) delete inp.dataset.customerId; }catch(_){ }
      // No forzamos el valor: mantenemos lo que el usuario escribió
      if (!inp.value && filter.displayName) inp.value = filter.displayName;
    }
  }

  // Badge
  if (badge){
    if (!filter){
      badge.textContent = 'Sin filtro';
      badge.classList.remove('closed');
      badge.classList.add('open');
    } else {
      let label = '';
      if (filter.type === 'id'){
        label = resolver ? (resolver.getDisplayName(filter.value) || filter.displayName || '') : (filter.displayName || '');
        if (!label) label = 'Cliente';
      } else {
        label = filter.displayName || 'Texto';
      }
      badge.textContent = 'Filtrando: ' + label + (filter.type === 'name' ? ' (texto)' : '');
      badge.classList.remove('open');
      badge.classList.add('closed');
    }
  }
}

function deriveSaleCustomerIdentityForSummaryPOS(s, resolver){
  let finalId = '';
  const rawName = getSaleCustomerSnapshotNamePOS(s);
  try{
    const rawId = (s && s.customerId != null) ? String(s.customerId).trim() : '';
    if (rawId){
      finalId = resolver ? (resolver.resolveFinalId(rawId) || rawId) : rawId;
    }
    // Etapa 3/3: ventas antiguas solo con nombre NO se vinculan por coincidencia.
    // Así se evita asociarlas a un cliente incorrecto tras renombres/duplicados.
  }catch(_){ }

  const displayName = rawName || (finalId && resolver ? resolver.getDisplayName(finalId) : '') || '';
  const nameKey = normalizeCustomerKeyPOS(displayName || rawName);
  const hasCustomer = !!(finalId || rawName);
  return { finalId, displayName, nameKey, rawName, hasCustomer };
}

function initSummaryCustomerFilterPOS(){
  const inp = document.getElementById('summary-customer');
  const pickBtn = document.getElementById('btn-summary-customer-pick');
  const clearBtn = document.getElementById('btn-summary-customer-clear');
  const tblTop = document.getElementById('tbl-top-clientes');

  if (!inp && !pickBtn && !clearBtn && !tblTop) return;

  // Restaurar UI desde storage
  try{
    const catalog = loadCustomerCatalogPOS();
    const resolver = buildCustomerResolverPOS(catalog);
    const f0 = getSummaryCustomerFilterPOS();
    if (f0 && f0.type === 'id'){
      const fid = resolver.resolveFinalId(f0.value) || f0.value;
      const dn = resolver.getDisplayName(fid) || f0.displayName || '';
      const n = { type: 'id', value: String(fid), displayName: dn };
      setSummaryCustomerFilterPOS(n, { silentUI: true });
      syncSummaryCustomerFilterUI_POS(n, resolver);
    } else {
      syncSummaryCustomerFilterUI_POS(f0, resolver);
    }
  }catch(_){
    syncSummaryCustomerFilterUI_POS(getSummaryCustomerFilterPOS());
  }

  if (pickBtn){
    pickBtn.addEventListener('click', ()=>{
      openCustomerPickerPOS((c)=>{
        try{
          const catalog = loadCustomerCatalogPOS();
          const resolver = buildCustomerResolverPOS(catalog);
          const rawId = String((c && c.id) || '').trim();
          const fid = resolver.resolveFinalId(rawId) || rawId;
          const dn = resolver.getDisplayName(fid) || sanitizeCustomerDisplayPOS((c && c.name) || '');
          setSummaryCustomerFilterPOS({ type:'id', value: fid, displayName: dn });
          renderSummary();
        }catch(err){
          console.warn('Error al seleccionar cliente para Resumen', err);
        }
      });
    });
  }

  if (clearBtn){
    clearBtn.addEventListener('click', ()=>{
      clearSummaryCustomerFilterPOS();
      renderSummary();
      try{ inp && inp.focus(); }catch(_){ }
    });
  }

  if (inp){
    const applyTyped = ()=>{
      const raw = sanitizeCustomerDisplayPOS(inp.value || '');
      if (!raw){
        clearSummaryCustomerFilterPOS();
        renderSummary();
        return;
      }
      try{
        const catalog = loadCustomerCatalogPOS();
        const resolver = buildCustomerResolverPOS(catalog);

        // Si el usuario pega un ID exacto
        let fid = '';
        const maybeId = String(raw).trim();
        try{ if (resolver && resolver.byId && resolver.byId.has(maybeId)) fid = resolver.resolveFinalId(maybeId) || maybeId; }catch(_){ }

        if (!fid) fid = resolver ? (resolver.matchNameToFinalId(raw) || '') : '';

        if (fid){
          const dn = resolver.getDisplayName(fid) || raw;
          if (dn) inp.value = dn;
          setSummaryCustomerFilterPOS({ type:'id', value: fid, displayName: dn || raw });
        } else {
          // Fallback por nombre (no crea clientes)
          const key = normalizeCustomerKeyPOS(raw);
          setSummaryCustomerFilterPOS({ type:'name', value: key, displayName: raw });
        }

        renderSummary();
      }catch(_){
        const key = normalizeCustomerKeyPOS(raw);
        setSummaryCustomerFilterPOS({ type:'name', value: key, displayName: raw });
        renderSummary();
      }
    };

    inp.addEventListener('blur', applyTyped);
    inp.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){
        e.preventDefault();
        try{ inp.blur(); }catch(_){ }
      }
    });
  }

  if (tblTop){
    tblTop.addEventListener('click', (e)=>{
      const tr = e.target.closest('tr');
      if (!tr) return;
      const type = (tr.dataset && tr.dataset.filterType) ? tr.dataset.filterType : '';
      const value = (tr.dataset && tr.dataset.filterValue) ? tr.dataset.filterValue : '';
      const name = (tr.dataset && tr.dataset.filterName) ? tr.dataset.filterName : '';
      if (!type || !value) return;
      setSummaryCustomerFilterPOS({ type, value, displayName: name });
      renderSummary();
      try{ document.getElementById('summary-customer')?.focus(); }catch(_){ }
    });
  }
}

// -----------------------------
// Resumen · Modo Archivo (snapshot)
// -----------------------------

function readSheetRowsPOS(sheets, sheetName){
  const name = (sheetName || '').toString().trim().toLowerCase();
  const sh = (sheets || []).find(s => s && (s.name || '').toString().trim().toLowerCase() === name);
  return (sh && Array.isArray(sh.rows)) ? sh.rows : [];
}

function applySummaryArchiveGuardsPOS(){
  const inArchive = (__A33_SUMMARY_MODE === 'archive');

  // Período selector y botón "Todo" (no aplica en Archivo)
  const periodEl = document.getElementById('summary-period');
  const btnAll = document.getElementById('btn-summary-all');
  if (periodEl) periodEl.disabled = inArchive;
  if (btnAll){
    // En Archivo: NO debe verse (no solo deshabilitado). Al salir: restaurar.
    if (btnAll.dataset && btnAll.dataset.prevDisplay == null) btnAll.dataset.prevDisplay = btnAll.style.display || '';
    if (inArchive){
      try{ btnAll.disabled = true; }catch(_){ }
      btnAll.style.display = 'none';
      try{ btnAll.classList.remove('is-active'); btnAll.setAttribute('aria-pressed','false'); }catch(_){ }
    } else {
      btnAll.style.display = (btnAll.dataset && btnAll.dataset.prevDisplay != null) ? (btnAll.dataset.prevDisplay || '') : '';
      try{ btnAll.disabled = false; }catch(_){ }
    }
  }

  if (inArchive && __A33_ACTIVE_ARCHIVE){
    const pk = String(__A33_ACTIVE_ARCHIVE.periodKey || (__A33_ACTIVE_ARCHIVE.snapshot && __A33_ACTIVE_ARCHIVE.snapshot.periodKey) || '').trim();
    if (periodEl && pk && /^\d{4}-\d{2}$/.test(pk)){
      try{ periodEl.value = pk; }catch(_){ }
    }
    // Mantener estado coherente (Archivo no usa "Todo")
    __A33_SUMMARY_VIEW_MODE = 'period';
  }

  // Bloquear/ocultar acciones que cambian data operativa
  const hideIds = ['btn-summary-close-day','btn-summary-reopen-day','btn-summary-close-period'];
  for (const id of hideIds){
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.dataset && el.dataset.prevDisplay == null) el.dataset.prevDisplay = el.style.display || '';
    if (el.dataset && el.dataset.prevDisabled == null) el.dataset.prevDisabled = el.disabled ? '1' : '0';
    if (inArchive){
      try{ el.disabled = true; }catch(_){ }
      el.style.display = 'none';
    } else {
      el.style.display = (el.dataset && el.dataset.prevDisplay != null) ? (el.dataset.prevDisplay || '') : '';
      try{ el.disabled = (el.dataset && el.dataset.prevDisabled === '1'); }catch(_){ }
    }
  }

  // Ocultar tarjeta de cierre diario en modo Archivo
  const dailyCard = document.getElementById('summary-daily-close-card');
  if (dailyCard){
    if (dailyCard.dataset && dailyCard.dataset.prevDisplay == null) dailyCard.dataset.prevDisplay = dailyCard.style.display || '';
    dailyCard.style.display = inArchive ? 'none' : ((dailyCard.dataset && dailyCard.dataset.prevDisplay != null) ? (dailyCard.dataset.prevDisplay || '') : '');
  }

  // Ocultar filtros de cliente en modo Archivo (no forman parte del snapshot)
  const customerCard = document.querySelector('.summary-customer-card');
  if (customerCard){
    if (customerCard.dataset && customerCard.dataset.prevDisplay == null) customerCard.dataset.prevDisplay = customerCard.style.display || '';
    customerCard.style.display = inArchive ? 'none' : ((customerCard.dataset && customerCard.dataset.prevDisplay != null) ? (customerCard.dataset.prevDisplay || '') : '');
  }
}

function syncSummaryAllButtonStatePOS(){
  const btnAll = document.getElementById('btn-summary-all');
  if (!btnAll) return;
  const active = (__A33_SUMMARY_MODE !== 'archive' && __A33_SUMMARY_VIEW_MODE === 'all');
  try{ btnAll.classList.toggle('is-active', !!active); }catch(_){ }
  try{ btnAll.setAttribute('aria-pressed', active ? 'true' : 'false'); }catch(_){ }
}

function getSummaryProductDisplayNamePOS(name){
  const raw = String(name || '—').trim() || '—';
  try{
    const ui = uiProductNamePOS(raw);
    return String(ui || raw).trim() || '—';
  }catch(_){
    return raw;
  }
}

function getSummarySaleQtyPOS(s){
  if (!s) return 0;
  const fields = ['qty','quantity','cantidad'];
  for (const f of fields){
    if (s[f] == null || s[f] === '') continue;
    const n = Number(s[f]);
    if (Number.isFinite(n) && Math.abs(n) > 1e-9) return n;
  }
  // Compatibilidad con ventas antiguas: si había total pero no cantidad, contar una unidad segura.
  const total = Number(s.total || 0);
  if (Number.isFinite(total) && Math.abs(total) > 1e-9) return s.isReturn ? -1 : 1;
  return 0;
}

function normalizeSummaryProductAggPOS(v){
  if (v && typeof v === 'object'){
    const total = Number(v.total ?? v.amount ?? v.val ?? v.value ?? 0) || 0;
    const hasQty = (v.qty != null || v.quantity != null || v.cantidad != null || v.sold != null || v.vendido != null);
    const qty = hasQty ? (Number(v.qty ?? v.quantity ?? v.cantidad ?? v.sold ?? v.vendido ?? 0) || 0) : 0;
    const qtyKnown = (v.qtyKnown === false) ? false : !!hasQty;
    return { total, qty, qtyKnown };
  }
  return { total: Number(v || 0) || 0, qty: 0, qtyKnown: false };
}

function addSummaryProductAggPOS(map, productName, total, qty, qtyKnown){
  if (!map) return;
  const key = getSummaryProductDisplayNamePOS(productName);
  const prev = normalizeSummaryProductAggPOS(map.get(key));
  prev.total += Number(total || 0) || 0;
  if (qtyKnown !== false){
    prev.qty += Number(qty || 0) || 0;
    prev.qtyKnown = true;
  }
  map.set(key, prev);
}

function formatSummarySoldQtyPOS(qty, qtyKnown){
  if (qtyKnown === false || qty == null || qty === '') return '—';
  const n = Number(qty);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toLocaleString('es-NI', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseSummaryProductSheetRowPOS(row, header){
  const r = Array.isArray(row) ? row : [];
  const h = Array.isArray(header) ? header : [];
  const name = getSummaryProductDisplayNamePOS(r[0] || '');
  const h1 = String(h[1] || '').toLowerCase();
  const h2 = String(h[2] || '').toLowerCase();
  const isNewShape = r.length >= 3 || h1.includes('vendido') || h1.includes('cantidad') || h2.includes('total');
  if (isNewShape){
    const qtyRaw = (r[1] == null || r[1] === '') ? null : Number(r[1]);
    const qtyKnown = qtyRaw != null && Number.isFinite(qtyRaw);
    return { key: name, qty: qtyKnown ? qtyRaw : 0, qtyKnown, total: Number(r[2] || 0) || 0 };
  }
  return { key: name, qty: 0, qtyKnown: false, total: Number(r[1] || 0) || 0 };
}

function summaryProductRowsFromMapPOS(map){
  return Array.from((map || new Map()).entries())
    .map(([k,v])=>{
      const agg = normalizeSummaryProductAggPOS(v);
      return { key: getSummaryProductDisplayNamePOS(k), qty: agg.qty || 0, qtyKnown: !!agg.qtyKnown, total: agg.total || 0, val: agg.total || 0 };
    })
    .filter(it=>it.key && !(/\(Cortesía\)/i.test(String(it.key))))
    .sort(compareSummaryProductByTotalDescPOS);
}

function summaryProductItemTotalPOS(it){
  return Number((it && (it.total ?? it.amount ?? it.val ?? it.value)) || 0) || 0;
}

function summaryProductItemNamePOS(it){
  const src = (it && typeof it === 'object') ? it : {};
  return getSummaryProductDisplayNamePOS(src.key ?? src.name ?? src.producto ?? src.product ?? src.productName ?? '');
}

function compareSummaryProductByTotalDescPOS(a, b){
  const ta = summaryProductItemTotalPOS(a);
  const tb = summaryProductItemTotalPOS(b);
  const diff = tb - ta;
  if (Math.abs(diff) > 0.000001) return diff;
  return String(summaryProductItemNamePOS(a)).localeCompare(String(summaryProductItemNamePOS(b)), 'es-NI');
}

function sortSummaryProductItemsByTotalPOS(items){
  return (Array.isArray(items) ? items.slice() : []).sort(compareSummaryProductByTotalDescPOS);
}

function sortSummaryPorProductoSheetRowsPOS(rows){
  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length <= 2) return safeRows.slice();
  const header = Array.isArray(safeRows[0]) ? safeRows[0] : [];
  const sortedBody = safeRows.slice(1)
    .map((row, idx)=>({ row, idx, item: parseSummaryProductSheetRowPOS(row, header) }))
    .sort((a,b)=>{
      const cmp = compareSummaryProductByTotalDescPOS(a.item, b.item);
      return cmp || (a.idx - b.idx);
    })
    .map(x=>x.row);
  return [safeRows[0], ...sortedBody];
}

function getSummarySaleDiscountSignedTotalPOS(s){
  const d = Number(getSaleDiscountTotalPOS(s) || 0) || 0;
  if (!Number.isFinite(d) || Math.abs(d) < 0.000001) return 0;
  return (s && s.isReturn) ? (-1 * d) : d;
}

function addSummaryDiscountAggPOS(map, productName, discountTotal){
  if (!map) return;
  const d = Number(discountTotal || 0) || 0;
  if (!Number.isFinite(d) || Math.abs(d) < 0.000001) return;
  const key = getSummaryProductDisplayNamePOS(productName);
  map.set(key, (Number(map.get(key) || 0) || 0) + d);
}

function summaryDiscountItemNamePOS(it){
  const src = (it && typeof it === 'object') ? it : {};
  return getSummaryProductDisplayNamePOS(src.key ?? src.name ?? src.producto ?? src.product ?? src.productName ?? '');
}

function summaryDiscountItemTotalPOS(it){
  const src = (it && typeof it === 'object') ? it : {};
  return Number(src.total ?? src.discount ?? src.amount ?? src.val ?? src.value ?? 0) || 0;
}

function compareSummaryDiscountByTotalDescPOS(a, b){
  const da = summaryDiscountItemTotalPOS(a);
  const db = summaryDiscountItemTotalPOS(b);
  const diff = db - da;
  if (Math.abs(diff) > 0.000001) return diff;
  return String(summaryDiscountItemNamePOS(a)).localeCompare(String(summaryDiscountItemNamePOS(b)), 'es-NI');
}

function summaryDiscountRowsFromMapPOS(map){
  return Array.from((map || new Map()).entries())
    .map(([key,total])=>({ key: getSummaryProductDisplayNamePOS(key), total: Number(total || 0) || 0 }))
    .filter(it=>it.key && Math.abs(Number(it.total || 0)) > 0.000001)
    .sort(compareSummaryDiscountByTotalDescPOS);
}

function parseSummaryDiscountSheetRowPOS(row){
  const r = Array.isArray(row) ? row : [];
  return {
    key: getSummaryProductDisplayNamePOS(r[0] || ''),
    total: Number(r[1] || 0) || 0
  };
}

function sortSummaryDescuentosSheetRowsPOS(rows){
  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length <= 2) return safeRows.slice();
  const sortedBody = safeRows.slice(1)
    .map((row, idx)=>({ row, idx, item: parseSummaryDiscountSheetRowPOS(row) }))
    .filter(x=>x.item && x.item.key)
    .sort((a,b)=> compareSummaryDiscountByTotalDescPOS(a.item, b.item) || (a.idx - b.idx))
    .map(x=>x.row);
  return [safeRows[0], ...sortedBody];
}

function sumSummaryDiscountSheetRowsPOS(rows){
  const safeRows = Array.isArray(rows) ? rows : [];
  return safeRows.slice(1).reduce((acc,row)=> acc + (Number((row && row[1]) || 0) || 0), 0);
}

function summaryProductItemQtyPOS(it){
  const src = (it && typeof it === 'object') ? it : {};
  const hasQty = !!(src.qty != null || src.quantity != null || src.cantidad != null || src.sold != null || src.vendido != null);
  const qtyKnown = (src.qtyKnown === false) ? false : hasQty;
  const qty = qtyKnown ? (Number(src.qty ?? src.quantity ?? src.cantidad ?? src.sold ?? src.vendido ?? 0) || 0) : 0;
  return { qty, qtyKnown };
}

function renderSummaryFromSnapshotPOS(archive){
  const a = archive || {};
  const snap = (a.snapshot && typeof a.snapshot === 'object') ? a.snapshot : {};
  const sheets = Array.isArray(snap.sheets) ? snap.sheets : [];
  const m = (snap.metrics && typeof snap.metrics === 'object') ? snap.metrics : {};

  const grand = Number(m.grand || 0) || 0;
  const discountSheetRowsForMetric = readSheetRowsPOS(sheets, 'Descuentos');
  const discountTotal = (m.discountTotal != null) ? (Number(m.discountTotal || 0) || 0) : sumSummaryDiscountSheetRowsPOS(discountSheetRowsForMetric);
  const grandCost = Number(m.grandCost || 0) || 0;
  const grandProfit = Number(m.grandProfit || 0) || 0;
  const courtesyCost = Number(m.courtesyCost || 0) || 0;
  const courtesyQty = Number(m.courtesyQty || 0) || 0;
  const courtesyTx = Number(m.courtesyTx || 0) || 0;
  const courtesyEquiv = Number(m.courtesyEquiv || 0) || 0;
  const profitAfterCourtesy = (m.profitAfterCourtesy != null) ? Number(m.profitAfterCourtesy || 0) : (grandProfit - courtesyCost);

  // KPIs
  const grandTotalEl = document.getElementById('grand-total');
  if (grandTotalEl) grandTotalEl.textContent = fmt(grand);
  const discountEl = document.getElementById('grand-discount');
  if (discountEl) discountEl.textContent = fmt(discountTotal);
  const costEl = document.getElementById('grand-cost');
  if (costEl) costEl.textContent = fmt(grandCost);
  const profitEl = document.getElementById('grand-profit');
  if (profitEl) profitEl.textContent = fmt(grandProfit);
  const courCostEl = document.getElementById('grand-courtesy-cost');
  if (courCostEl) courCostEl.textContent = fmt(courtesyCost);
  const profitAfterEl = document.getElementById('grand-profit-after-courtesy');
  if (profitAfterEl) profitAfterEl.textContent = fmt(profitAfterCourtesy);

  // Cortesías
  const courTotalCostEl = document.getElementById('courtesy-total-cost');
  if (courTotalCostEl) courTotalCostEl.textContent = fmt(courtesyCost);
  const courTotalQtyEl = document.getElementById('courtesy-total-qty');
  if (courTotalQtyEl) courTotalQtyEl.textContent = String(Math.round(courtesyQty));
  const courTotalEquivEl = document.getElementById('courtesy-total-equiv');
  if (courTotalEquivEl) courTotalEquivEl.textContent = fmt(courtesyEquiv);
  const courTxEl = document.getElementById('courtesy-total-tx');
  if (courTxEl) courTxEl.textContent = String(courtesyTx);

  // Clientes (no disponible en snapshot): placeholders
  const uniqueCustomersEl = document.getElementById('summary-customers-unique');
  if (uniqueCustomersEl) uniqueCustomersEl.textContent = '—';
  const salesWithCustomerEl = document.getElementById('summary-sales-with-customer');
  if (salesWithCustomerEl) salesWithCustomerEl.textContent = '—';
  const salesWithCustomerPctEl = document.getElementById('summary-sales-with-customer-pct');
  if (salesWithCustomerPctEl) salesWithCustomerPctEl.textContent = '—';

  const topCustomersBody = document.querySelector('#tbl-top-clientes tbody');
  if (topCustomersBody){
    topCustomersBody.innerHTML = '';
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="3" class="muted">(no disponible en snapshot)</td>';
    topCustomersBody.appendChild(tr);
  }

  // Tablas desde hojas
  const byEventRows = readSheetRowsPOS(sheets, 'PorEvento').slice(1)
    .map(r=>({ k: String((r&&r[0])||'').trim(), v: Number((r&&r[1])||0) || 0 }))
    .filter(it=>it.k);
  byEventRows.sort((a,b)=>a.k.localeCompare(b.k,'es-NI'));

  const tbE = document.querySelector('#tbl-por-evento tbody');
  if (tbE){
    tbE.innerHTML = '';
    for (const it of byEventRows){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(it.k)}</td><td>${fmt(it.v)}</td>`;
      tbE.appendChild(tr);
    }
  }

  const byDayRows = readSheetRowsPOS(sheets, 'PorDia').slice(1)
    .map(r=>({ k: String((r&&r[0])||'').trim(), v: Number((r&&r[1])||0) || 0 }))
    .filter(it=>it.k);
  byDayRows.sort((a,b)=>String(b.k).localeCompare(String(a.k)));

  const tbD = document.querySelector('#tbl-por-dia tbody');
  if (tbD){
    tbD.innerHTML = '';
    for (const it of byDayRows){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(it.k)}</td><td>${fmt(it.v)}</td>`;
      tbD.appendChild(tr);
    }
  }

  const prodSheetRows = readSheetRowsPOS(sheets, 'PorProducto');
  const prodHeader = Array.isArray(prodSheetRows) && prodSheetRows.length ? prodSheetRows[0] : [];
  const byProdRows = (prodSheetRows || []).slice(1)
    .map(r=>parseSummaryProductSheetRowPOS(r, prodHeader))
    .filter(it=>it.key);
  byProdRows.sort(compareSummaryProductByTotalDescPOS);

  const tbP = document.querySelector('#tbl-por-prod tbody');
  if (tbP){
    tbP.innerHTML = '';
    for (const it of byProdRows){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(it.key)}</td><td>${formatSummarySoldQtyPOS(it.qty, it.qtyKnown)}</td><td>${fmt(it.total)}</td>`;
      tbP.appendChild(tr);
    }
  }

  const tbDisc = document.querySelector('#tbl-discounts-byprod tbody');
  if (tbDisc){
    tbDisc.innerHTML = '';
    const discRows = (readSheetRowsPOS(sheets, 'Descuentos') || []).slice(1)
      .map(r=>parseSummaryDiscountSheetRowPOS(r))
      .filter(it=>it.key && Math.abs(Number(it.total || 0)) > 0.000001)
      .sort(compareSummaryDiscountByTotalDescPOS);

    if (discRows.length){
      for (const it of discRows){
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(it.key)}</td><td>${fmt(it.total)}</td>`;
        tbDisc.appendChild(tr);
      }
    } else {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="2" class="muted">(sin descuentos)</td>';
      tbDisc.appendChild(tr);
    }
  }

  const byPayRows = readSheetRowsPOS(sheets, 'PorPago').slice(1)
    .map(r=>({ k: String((r&&r[0])||'').trim(), v: Number((r&&r[1])||0) || 0 }))
    .filter(it=>it.k);
  byPayRows.sort((a,b)=>a.k.localeCompare(b.k,'es-NI'));

  const tbPay = document.querySelector('#tbl-por-pago tbody');
  if (tbPay){
    tbPay.innerHTML = '';
    for (const it of byPayRows){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(getPaymentMethodLabelPOS(it.k))}</td><td>${fmt(it.v)}</td>`;
      tbPay.appendChild(tr);
    }
  }

  // Transferencias por banco
  const tbBank = document.querySelector('#tbl-transfer-bank tbody');
  if (tbBank){
    tbBank.innerHTML = '';
    const rows = readSheetRowsPOS(sheets, 'TransferenciasBanco').slice(1)
      .map(r=>({ bank: String((r&&r[0])||'').trim(), total: Number((r&&r[1])||0)||0, count: Number((r&&r[2])||0)||0 }))
      .filter(it=>it.bank);

    if (rows.length){
      rows.sort((a,b)=>String(a.bank).localeCompare(String(b.bank),'es-NI'));
      for (const it of rows){
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(it.bank)}</td><td>${fmt(it.total)}</td><td>${it.count||0}</td>`;
        tbBank.appendChild(tr);
      }
    } else {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3" class="muted">(sin transferencias)</td>';
      tbBank.appendChild(tr);
    }
  }

  // Cortesías por producto
  const tbCour = document.querySelector('#tbl-courtesy-byprod tbody');
  if (tbCour){
    tbCour.innerHTML = '';
    const rows = readSheetRowsPOS(sheets, 'Cortesias').slice(1)
      .map(r=>({ name: String((r&&r[0])||'').trim(), qty: Number((r&&r[1])||0)||0, cost: Number((r&&r[2])||0)||0, equiv: Number((r&&r[3])||0)||0 }))
      .filter(it=>it.name);

    if (rows.length){
      rows.sort((a,b)=>String(a.name).localeCompare(String(b.name),'es-NI'));
      for (const it of rows){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(it.name)}</td>
          <td>${Math.round(it.qty||0)}</td>
          <td>${fmt(it.cost)}</td>
          <td>${fmt(it.equiv)}</td>
        `;
        tbCour.appendChild(tr);
      }
    } else {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4" class="muted">(sin cortesías)</td>';
      tbCour.appendChild(tr);
    }
  }
}

async function renderSummary(){
  // Modo Archivo (snapshot): renderizar sin tocar stores operativos
  if (__A33_SUMMARY_MODE === 'archive' && __A33_ACTIVE_ARCHIVE){
    try{ renderSummaryFromSnapshotPOS(__A33_ACTIVE_ARCHIVE); }catch(err){ console.error('renderSummaryFromSnapshotPOS', err); }
    try{ setSummaryModeBadgePOS(); }catch(_){ }
    try{ syncSummaryPeriodLabelPOS(); }catch(_){ }
    try{ applySummaryArchiveGuardsPOS(); }catch(_){ }
    return;
  }

  let sales = await getAll('sales');
  const events = await getAll('events');
  const products = await getAll('products');

  // Filtro por período (YYYY-MM) en Resumen
  try{
    const periodKey = getActiveSummaryPeriodFilterPOS();
    if (periodKey){
      sales = (sales || []).filter(s => isSaleInPeriodPOS(s, periodKey));
    }
  }catch(_){ }

  // Gatekeeper de cierre de período: necesita ventas del período SIN filtrar por evento
  const __A33_salesInPeriodAllEvents = Array.isArray(sales) ? sales.slice() : [];

  // Filtro por evento en Resumen (GLOBAL vs EVENTO)
  let selectedSummaryEventId = SUMMARY_EVENT_GLOBAL_POS;
  try{ selectedSummaryEventId = await getSelectedSummaryEventIdPOS(); }catch(_){ selectedSummaryEventId = SUMMARY_EVENT_GLOBAL_POS; }
  const selectedSummaryEventNum = parseSummaryEventIdPOS(selectedSummaryEventId);
  if (selectedSummaryEventNum != null){
    sales = (sales || []).filter(s => (s && s.eventId != null && Number(s.eventId) === selectedSummaryEventNum));
  }

  const productById = new Map();
  const productByName = new Map();
  for (const p of (products || [])){
    if (!p) continue;
    if (p.id != null) productById.set(Number(p.id), p);
    if (p.name) productByName.set(String(p.name), p);
  }

  const isCourtesySale = (s) => !!(s && (s.courtesy || s.isCourtesy));
  const normalizeCourtesyProductName = (name) => String(name || '—').replace(/\s*\(Cortesía\)\s*$/i, '').trim() || '—';

  const getLineCost = (s) => getSaleLineCostSnapshotPOS(s);

  const getListUnitPrice = (s) => {
    if (!s) return 0;
    const unit = Number(s.unitPrice || 0);
    if (unit > 0) return unit;

    const pid = (s.productId != null) ? Number(s.productId) : null;
    if (pid != null && productById.has(pid)){
      const p = productById.get(pid);
      const pr = Number(p && p.price) || 0;
      if (pr > 0) return pr;
    }

    const n = normalizeCourtesyProductName(s.productName || '');
    if (n && productByName.has(n)){
      const p = productByName.get(n);
      const pr = Number(p && p.price) || 0;
      if (pr > 0) return pr;
    }

    return 0;
  };

  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){
    if (b && b.id != null) bankMap.set(Number(b.id), b.name || '');
  }

  const transferByBank = new Map();

  // Ventas reales (ingresos)
  let grand = 0;
  let discountTotal = 0;
  let grandCost = 0;
  let grandProfit = 0;

  // Cortesías (impacto real + equivalente informativo)
  let courtesyCost = 0;
  let courtesyQty = 0; // unidades (suma de qty abs)
  let courtesyEquiv = 0;
  let courtesyTx = 0;

  const courtesyByProd = new Map(); // name -> { qty, cost, equiv }

  const byDay = new Map();
  const byProd = new Map();
  const byDiscount = new Map();
  const byPay = new Map();
  const byEvent = new Map();

  // --- Cliente: resolver + filtro activo ---
  let resolver = null;
  try{
    const catalog = loadCustomerCatalogPOS();
    resolver = buildCustomerResolverPOS(catalog);
  }catch(_){ resolver = null; }

  let summaryCustomerFilter = getSummaryCustomerFilterPOS();
  try{
    if (summaryCustomerFilter && summaryCustomerFilter.type === 'name'){
      const key = normalizeCustomerKeyPOS(summaryCustomerFilter.value || summaryCustomerFilter.displayName || '');
      if (key && key !== summaryCustomerFilter.value){
        summaryCustomerFilter = setSummaryCustomerFilterPOS({ type:'name', value: key, displayName: summaryCustomerFilter.displayName || '' }, { silentUI: true });
      }
    }
    if (summaryCustomerFilter && summaryCustomerFilter.type === 'id' && resolver){
      const fid = resolver.resolveFinalId(summaryCustomerFilter.value) || summaryCustomerFilter.value;
      const dn = resolver.getDisplayName(fid) || summaryCustomerFilter.displayName || '';
      if (fid !== summaryCustomerFilter.value || dn !== summaryCustomerFilter.displayName){
        summaryCustomerFilter = setSummaryCustomerFilterPOS({ type:'id', value: String(fid), displayName: dn || summaryCustomerFilter.displayName || '' }, { silentUI: true });
      }
    }
  }catch(_){ }

  syncSummaryCustomerFilterUI_POS(summaryCustomerFilter, resolver);
  const isCustomerFilterActive = !!(summaryCustomerFilter && summaryCustomerFilter.value);

  // KPIs/Top clientes (solo ventas reales)
  const customersAgg = new Map(); // key -> { total, count, filterType, filterValue, name }
  let realSalesCount = 0;
  let salesWithCustomerCount = 0;

  for (const s of (sales || [])){

    if (!s) continue;

    const ident = deriveSaleCustomerIdentityForSummaryPOS(s, resolver);
    if (isCustomerFilterActive && summaryCustomerFilter){
      if (summaryCustomerFilter.type === 'id'){
        if (!ident.finalId || ident.finalId !== summaryCustomerFilter.value) continue;
      } else if (summaryCustomerFilter.type === 'name'){
        const key = normalizeCustomerKeyPOS(ident.rawName || ident.displayName);
        if (!key || key !== summaryCustomerFilter.value) continue;
      }
    }

    const total = Number(s.total || 0);
    const courtesy = isCourtesySale(s);

    if (!courtesy){
      grand += total;

      const saleDiscount = getSummarySaleDiscountSignedTotalPOS(s);
      discountTotal += saleDiscount;
      addSummaryDiscountAggPOS(byDiscount, getSaleProductNameSnapshotPOS(s), saleDiscount);

      byDay.set(s.date, (byDay.get(s.date) || 0) + total);
      addSummaryProductAggPOS(byProd, getSaleProductNameSnapshotPOS(s), total, getSummarySaleQtyPOS(s), true);
      const payKey = normalizePaymentMethodPOS(s.payment || 'efectivo') || 'efectivo';
      byPay.set(payKey, (byPay.get(payKey) || 0) + total);
      byEvent.set(s.eventName || 'General', (byEvent.get(s.eventName || 'General') || 0) + total);

      // Transferencias por banco
      if (normalizePaymentMethodPOS(s.payment || '') === 'transferencia'){
        const label = getSaleBankLabel(s, bankMap);
        const cur = transferByBank.get(label) || { total: 0, count: 0 };
        cur.total += total;
        cur.count += 1;
        transferByBank.set(label, cur);
      }

      // Costo y utilidad aproximada (ventas reales)
      const lineCost = getLineCost(s);
      let lineProfit = 0;
      if (typeof s.lineProfit === 'number' && Number.isFinite(s.lineProfit)) {
        lineProfit = Number(s.lineProfit || 0);
      } else {
        lineProfit = total - lineCost;
      }
      grandCost += lineCost;
      grandProfit += lineProfit;

      // --- Clientes (MVP) ---
      realSalesCount += 1;
      if (ident && (ident.finalId || ident.rawName)) salesWithCustomerCount += 1;

      let custKey = '';
      let custFilterType = '';
      let custFilterValue = '';
      let custName = '';

      if (ident && ident.finalId){
        const snapKey = normalizeCustomerKeyPOS(ident.rawName || ident.displayName || '');
        custKey = 'id:' + ident.finalId + (snapKey ? (':snap:' + snapKey) : '');
        custFilterType = 'id';
        custFilterValue = ident.finalId;
        custName = ident.rawName || ident.displayName || (resolver ? (resolver.getDisplayName(ident.finalId) || '') : '') || 'Cliente';
      } else {
        const nk = normalizeCustomerKeyPOS((ident && (ident.rawName || ident.displayName)) || '');
        if (nk){
          custKey = 'name:' + nk;
          custFilterType = 'name';
          custFilterValue = nk;
          custName = (ident && (ident.rawName || ident.displayName)) || nk;
        }
      }

      if (custKey){
        const curCust = customersAgg.get(custKey) || { total: 0, count: 0, filterType: custFilterType, filterValue: custFilterValue, name: custName };
        curCust.total += total;
        curCust.count += 1;
        if (custName && (!curCust.name || custName.length > curCust.name.length)) curCust.name = custName;
        curCust.filterType = custFilterType;
        curCust.filterValue = custFilterValue;
        customersAgg.set(custKey, curCust);
      }

    } else {
      courtesyTx += 1;

      const qRaw = Number(s.qty || 0);
      const absQty = Math.abs(qRaw);
      const sign = (s.isReturn || qRaw < 0) ? -1 : 1;

      courtesyQty += absQty;

      const lineCost = getLineCost(s);
      courtesyCost += lineCost;

      const listUnit = getListUnitPrice(s);
      const eq = sign * absQty * listUnit;
      courtesyEquiv += eq;

      const pname = normalizeCourtesyProductName(getSaleProductNameSnapshotPOS(s));
      const prev = courtesyByProd.get(pname) || { qty: 0, cost: 0, equiv: 0 };
      prev.qty += absQty;
      prev.cost += lineCost;
      prev.equiv += eq;
      courtesyByProd.set(pname, prev);
    }
  }

  // Acumular también lo archivado por evento (si existiera)
  if (!isCustomerFilterActive){
    for (const ev of (events || [])){
    if (ev.archive && ev.archive.totals){
      const t = ev.archive.totals;

      grand += (t.grand || 0);
      discountTotal += (Number(t.discountTotal || 0) || 0);
      byEvent.set(ev.name, (byEvent.get(ev.name) || 0) + (t.grand || 0));

      if (t.byPay){
        for (const k of Object.keys(t.byPay)){
          byPay.set(k, (byPay.get(k) || 0) + (t.byPay[k] || 0));
        }
      }

      // Por producto: excluir cualquier llave tipo "(Cortesía)" y conservar cantidad si existe.
      if (t.byProduct){
        for (const k of Object.keys(t.byProduct)){
          if (/\(Cortesía\)/i.test(String(k))) continue;
          const raw = t.byProduct[k];
          const agg = normalizeSummaryProductAggPOS(raw);
          addSummaryProductAggPOS(byProd, k, agg.total, agg.qty, agg.qtyKnown);
        }
      }

      if (t.byDiscount){
        for (const k of Object.keys(t.byDiscount)){
          addSummaryDiscountAggPOS(byDiscount, k, Number(t.byDiscount[k] || 0) || 0);
        }
      }

      if (t.byDay){
        for (const k of Object.keys(t.byDay)){
          byDay.set(k, (byDay.get(k) || 0) + (t.byDay[k] || 0));
        }
      }

      // Nota: por ahora no tenemos costo/utilidad/cortesías archivados.
    }
  }
  }

  const profitAfterCourtesy = grandProfit - courtesyCost;

  // --- Top KPIs ---
  const grandTotalEl = document.getElementById('grand-total');
  if (grandTotalEl) grandTotalEl.textContent = fmt(grand);

  const discountEl = document.getElementById('grand-discount');
  if (discountEl) discountEl.textContent = fmt(discountTotal);

  const costEl = document.getElementById('grand-cost');
  if (costEl) costEl.textContent = fmt(grandCost);

  const profitEl = document.getElementById('grand-profit');
  if (profitEl) profitEl.textContent = fmt(grandProfit);

  const courCostEl = document.getElementById('grand-courtesy-cost');
  if (courCostEl) courCostEl.textContent = fmt(courtesyCost);

  const profitAfterEl = document.getElementById('grand-profit-after-courtesy');
  if (profitAfterEl) profitAfterEl.textContent = fmt(profitAfterCourtesy);


  // --- Clientes (MVP) ---
  const uniqueCustomersEl = document.getElementById('summary-customers-unique');
  if (uniqueCustomersEl) uniqueCustomersEl.textContent = String(customersAgg.size);

  const salesWithCustomerEl = document.getElementById('summary-sales-with-customer');
  if (salesWithCustomerEl) salesWithCustomerEl.textContent = String(salesWithCustomerCount);

  const salesWithCustomerPctEl = document.getElementById('summary-sales-with-customer-pct');
  if (salesWithCustomerPctEl){
    const pct = realSalesCount ? (salesWithCustomerCount / realSalesCount * 100) : 0;
    salesWithCustomerPctEl.textContent = String(Math.round(pct));
  }

  const topCustomersBody = document.querySelector('#tbl-top-clientes tbody');
  if (topCustomersBody){
    topCustomersBody.innerHTML = '';
    const entries = Array.from(customersAgg.values())
      .sort((a,b)=>Number((b&&b.total)||0) - Number((a&&a.total)||0))
      .slice(0, 10);

    if (!entries.length){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="3" class="muted">(sin datos)</td>`;
      topCustomersBody.appendChild(tr);
    } else {
      for (const it of entries){
        if (!it) continue;
        const tr = document.createElement('tr');
        tr.dataset.filterType = it.filterType || '';
        tr.dataset.filterValue = it.filterValue || '';
        tr.dataset.filterName = it.name || '';
        tr.innerHTML = `<td>${escapeHtml(it.name||'')}</td><td>${fmt(Number(it.total||0))}</td><td>${it.count||0}</td>`;
        topCustomersBody.appendChild(tr);
      }
    }
  }

  // Compat: si no existe el bloque superior nuevo, intentamos crearlo sin romper el HTML viejo
  if (!discountEl || !costEl || !profitEl || !courCostEl || !profitAfterEl){
    const totalSpan = document.getElementById('grand-total');
    if (totalSpan){
      const card = totalSpan.closest('.card') || totalSpan.parentElement || document.getElementById('tab-resumen') || document.body;
      let extraBlock = document.getElementById('grand-extra-block');
      if (!extraBlock){
        extraBlock = document.createElement('div');
        extraBlock.id = 'grand-extra-block';
        if (card) card.appendChild(extraBlock);
      }
      extraBlock.innerHTML = `
        <p>Total descuento: C$ <span id="grand-discount">${fmt(discountTotal)}</span></p>
        <p>Costo estimado de producto: C$ <span id="grand-cost">${fmt(grandCost)}</span></p>
        <p>Utilidad bruta aproximada: C$ <span id="grand-profit">${fmt(grandProfit)}</span></p>
        <p>Cortesías (Costo real): C$ <span id="grand-courtesy-cost">${fmt(courtesyCost)}</span></p>
        <p>Utilidad después de cortesías: C$ <span id="grand-profit-after-courtesy">${fmt(profitAfterCourtesy)}</span></p>
      `;
    }
  }

  // --- Tablas existentes (solo ventas reales) ---
  const tbE = document.querySelector('#tbl-por-evento tbody');
  if (tbE){
    tbE.innerHTML = '';
    [...byEvent.entries()]
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'es-NI'))
      .forEach(([k,v])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${fmt(v)}</td>`;
        tbE.appendChild(tr);
      });
  }

  const tbD = document.querySelector('#tbl-por-dia tbody');
  if (tbD){
    tbD.innerHTML = '';
    // Más reciente primero (YYYY-MM-DD)
    [...byDay.entries()]
      .sort((a,b)=>String(b[0]).localeCompare(String(a[0])))
      .forEach(([k,v])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${fmt(v)}</td>`;
        tbD.appendChild(tr);
      });
  }

  const tbP = document.querySelector('#tbl-por-prod tbody');
  if (tbP){
    tbP.innerHTML = '';
    summaryProductRowsFromMapPOS(byProd).forEach((it)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(it.key)}</td><td>${formatSummarySoldQtyPOS(it.qty, it.qtyKnown)}</td><td>${fmt(it.total)}</td>`;
      tbP.appendChild(tr);
    });
  }


  const tbDisc = document.querySelector('#tbl-discounts-byprod tbody');
  if (tbDisc){
    tbDisc.innerHTML = '';
    const entries = summaryDiscountRowsFromMapPOS(byDiscount);
    if (entries.length){
      for (const it of entries){
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(it.key)}</td><td>${fmt(it.total)}</td>`;
        tbDisc.appendChild(tr);
      }
    } else {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="2" class="muted">(sin descuentos)</td>`;
      tbDisc.appendChild(tr);
    }
  }

  const tbPay = document.querySelector('#tbl-por-pago tbody');
  if (tbPay){
    tbPay.innerHTML = '';
    [...byPay.entries()]
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'es-NI'))
      .forEach(([k,v])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(getPaymentMethodLabelPOS(k))}</td><td>${fmt(v)}</td>`;
        tbPay.appendChild(tr);
      });
  }

  // Tabla: Transferencias por banco (Resumen)
  const tbBank = document.querySelector('#tbl-transfer-bank tbody');
  if (tbBank){
    tbBank.innerHTML = '';
    if (transferByBank.size){
      const entries = Array.from(transferByBank.entries())
        .sort((a,b)=> (Number((b[1]||{}).total||0) - Number((a[1]||{}).total||0)));
      for (const [label, obj] of entries){
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(label)}</td><td>${fmt(Number(obj.total||0))}</td><td>${obj.count||0}</td>`;
        tbBank.appendChild(tr);
      }
    } else {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="3" class="muted">(sin transferencias)</td>`;
      tbBank.appendChild(tr);
    }
  }

  // --- Nueva sección: Cortesías ---
  const courTotalCostEl = document.getElementById('courtesy-total-cost');
  if (courTotalCostEl) courTotalCostEl.textContent = fmt(courtesyCost);

  const courTotalQtyEl = document.getElementById('courtesy-total-qty');
  if (courTotalQtyEl) courTotalQtyEl.textContent = String(Math.round(courtesyQty));

  const courTotalEquivEl = document.getElementById('courtesy-total-equiv');
  if (courTotalEquivEl) courTotalEquivEl.textContent = fmt(courtesyEquiv);

  const courTxEl = document.getElementById('courtesy-total-tx');
  if (courTxEl) courTxEl.textContent = String(courtesyTx);

  const tbCour = document.querySelector('#tbl-courtesy-byprod tbody');
  if (tbCour){
    tbCour.innerHTML = '';
    if (courtesyByProd.size){
      const entries = Array.from(courtesyByProd.entries())
        .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'es-NI'));

      for (const [name, obj] of entries){
        const q = obj ? Number(obj.qty || 0) : 0;
        const c = obj ? Number(obj.cost || 0) : 0;
        const e = obj ? Number(obj.equiv || 0) : 0;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(name)}</td>
          <td>${Math.round(q)}</td>
          <td>${fmt(c)}</td>
          <td>${fmt(e)}</td>
        `;
        tbCour.appendChild(tr);
      }
    } else {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4" class="muted">(sin cortesías)</td>`;
      tbCour.appendChild(tr);
    }
  }

  // Cierre diario (tarjeta Resumen)
  try{ await renderSummaryDailyCloseCardPOS(); }catch(e){}
  // Guardas por modo (restaura botones al salir de Archivo)
  try{ applySummaryArchiveGuardsPOS(); }catch(_){ }
  try{ await applyClosePeriodGatekeeperUI_POS({ periodKey: getSummarySelectedPeriodKeyPOS(), salesInPeriod: __A33_salesInPeriodAllEvents, eventsAll: events }); }catch(_){ }
}

async function renderSummaryDailyCloseCardPOS(){
  const card = document.getElementById('summary-daily-close-card');
  if (!card) return;

  // En modo Archivo no se muestran/validan cierres diarios
  if (__A33_SUMMARY_MODE === 'archive'){
    try{ card.style.display = 'none'; }catch(_){ }
    return;
  }
  try{ card.style.display = ''; }catch(_){ }

  const statusEl = document.getElementById('summary-close-status');
  const eventSel = document.getElementById('summary-close-event');
  const dateEl = document.getElementById('summary-close-date');
  const btnClose = document.getElementById('btn-summary-close-day');
  const btnReopen = document.getElementById('btn-summary-reopen-day');
  const noteEl = document.getElementById('summary-close-note');
  const blockerEl = document.getElementById('summary-close-blocker');
  const targetEl = document.getElementById('summary-close-target');
  const returnEl = document.getElementById('summary-close-return');

  let selectedSummaryEventId = SUMMARY_EVENT_GLOBAL_POS;
  try{ selectedSummaryEventId = await getSelectedSummaryEventIdPOS(); }catch(_){ selectedSummaryEventId = SUMMARY_EVENT_GLOBAL_POS; }
  const selectedSummaryEventNum = parseSummaryEventIdPOS(selectedSummaryEventId);
  const ev = (selectedSummaryEventNum != null) ? await getEventByIdPOS(selectedSummaryEventNum) : null;

  const saleDate = document.getElementById('sale-date')?.value || '';
  if (dateEl && !dateEl.value){
    dateEl.value = safeYMD(saleDate || todayYMD());
  }
  const dayKey = safeYMD(dateEl ? dateEl.value : (saleDate || todayYMD()));

  // Mantener selector sincronizado con el evento seleccionado en Resumen (GLOBAL vs evento)
  if (eventSel){
    const want = String(selectedSummaryEventId || SUMMARY_EVENT_GLOBAL_POS);
    const has = want && Array.from(eventSel.options).some(o=> String(o.value) === want);
    eventSel.value = has ? want : SUMMARY_EVENT_GLOBAL_POS;
  }

  // Defaults
  if (btnClose){ btnClose.disabled = true; btnClose.style.display = ''; }
  if (btnReopen){ btnReopen.disabled = true; btnReopen.style.display = ''; }
  if (noteEl){ noteEl.style.display = 'none'; noteEl.textContent = ''; }

  if (!ev){
    const isGlobal = isSummaryGlobalPOS(selectedSummaryEventId);

    if (statusEl){
      statusEl.className = 'pill';
      statusEl.textContent = isGlobal ? 'GLOBAL' : '—';
    }

    if (btnClose){
      btnClose.disabled = true;
      if (isGlobal) btnClose.style.display = 'none';
    }

    if (btnReopen){
      btnReopen.disabled = true;
      if (isGlobal) btnReopen.style.display = 'none';
    }

    if (noteEl){
      noteEl.style.display = 'block';
      noteEl.textContent = isGlobal
        ? 'GLOBAL es solo lectura. Selecciona un evento para cerrar.'
        : 'Selecciona un evento aquí para poder cerrar o reabrir el día.';
    }

    if (targetEl){ targetEl.style.display = 'none'; targetEl.textContent = ''; }
    if (returnEl){ returnEl.style.display = 'none'; returnEl.innerHTML = ''; delete returnEl.dataset.forEventId; delete returnEl.dataset.prevEventId; }
    if (blockerEl){ blockerEl.style.display = 'none'; blockerEl.innerHTML = ''; }

  try{ await renderSummaryCashV2SnapshotPOS({ eventId: null, dayKey: null }); }catch(_){ }
    return;
  }

  const lock = await getDayLockRecordPOS(ev.id, dayKey);

  // Objetivo visible
  if (targetEl){
    targetEl.style.display = 'block';
    targetEl.textContent = `Vas a cerrar el día de: ${ev.name} · Fecha: ${dayKey}`;
  }

  // Si existe un banner de "volver", ocultarlo cuando cambie el evento actual
  if (returnEl && returnEl.dataset.forEventId && returnEl.dataset.forEventId !== String(ev.id)){
    returnEl.style.display = 'none';
    returnEl.innerHTML = '';
    delete returnEl.dataset.forEventId;
    delete returnEl.dataset.prevEventId;
  }

  const isClosed = !!(lock && lock.isClosed);
  const closedAt = (lock && lock.closedAt) ? lock.closedAt : null;

  let version = lock ? (lock.lastClosureVersion || null) : null;
  if (!version){
    const maxV = await getMaxDailyClosureVersionPOS(ev.id, dayKey);
    version = maxV ? maxV : null;
  }

  // Estado técnico (closureKey / lastClosureKey / lockRecord completo)
  try{
    const lockKey = makeDayLockKeyPOS(ev.id, dayKey);
    const lastV = (version != null) ? Number(version) : null;
    const lastClosureKey = (lock && (lock.lastClosureKey || (lock.lastClosureVersion ? makeDailyClosureKeyPOS(ev.id, dayKey, lock.lastClosureVersion) : null))) || null;
    const proposedV = isClosed ? lastV : ((lastV && lastV > 0) ? (lastV + 1) : 1);
    const closureKey = isClosed
      ? (lastClosureKey || ((lastV && lastV > 0) ? makeDailyClosureKeyPOS(ev.id, dayKey, lastV) : null))
      : makeDailyClosureKeyPOS(ev.id, dayKey, proposedV);

    const setTech = (id, val, mono=false)=>{
      const el = document.getElementById(id);
      if (!el) return;
      try{ el.textContent = (val != null && String(val).trim() !== '') ? String(val) : '—'; }catch(_){ }
      try{ if (mono) el.classList.add('tech-mono'); }catch(_){ }
    };

    setTech('summary-tech-closurekey', closureKey || '—', true);
    setTech('summary-tech-lastclosurekey', lastClosureKey || '—', true);
    setTech('summary-tech-lockkey', lockKey || '—', true);
    setTech('summary-tech-version', (lastV && lastV > 0) ? ('v' + lastV) : '—', true);

    const pre = document.getElementById('summary-tech-lockrecord');
    if (pre){
      const payload = (lock && typeof lock === 'object') ? lock : null;
      pre.textContent = payload ? JSON.stringify(payload, null, 2) : '—';
    }
  }catch(_){ }

  // UI: status pill
  if (statusEl){
    if (isClosed){
      statusEl.className = 'pill danger';
      statusEl.textContent = version ? `Cerrado (v${version})` : 'Cerrado';
    } else {
      statusEl.className = 'pill';
      statusEl.textContent = version ? `Abierto · último cierre v${version}` : 'Abierto';
    }
  }

  if (btnClose){
    btnClose.style.display = isClosed ? 'none' : '';
    btnClose.disabled = !!isClosed;
  }
  if (btnReopen){
    btnReopen.style.display = isClosed ? '' : 'none';
    btnReopen.disabled = !isClosed;
  }

  if (noteEl){
    if (isClosed){
      noteEl.style.display = 'block';
      noteEl.textContent = closedAt
        ? `Día bloqueado para ventas/movimientos. Cerrado: ${formatDateTime(closedAt)}`
        : 'Día bloqueado para ventas/movimientos.';
    } else {
      noteEl.style.display = 'none';
      noteEl.textContent = '';
    }
  }

  try{ await renderSummaryCashV2SnapshotPOS({ eventId: ev.id, dayKey }); }catch(_){ }

}

// --- POS: Efectivo v2 — Snapshot para Cierre Diario / Resumen (Etapa 8)
function cashV2BlankCloseNumsPOS(){
  return {
    NIO: { initial:0, net:0, expected:0, final:0, diff:0 },
    USD: { initial:0, net:0, expected:0, final:0, diff:0 }
  };
}

async function cashV2ComputeSnapshotPOS(eventId, dayKey){
  const eid = Number(eventId);
  const dk = safeYMD(dayKey);
  if (!eid || !dk) return null;

  let rec = null;
  try{ rec = await cashV2Load(eid, dk); }catch(err){
    console.warn('cashV2ComputeSnapshotPOS: no se pudo leer record', err);
    rec = null;
  }

  const status = rec ? String(rec.status || 'OPEN').trim().toUpperCase() : 'MISSING';

  try{
    if (rec && status !== 'CLOSED') await cashV2RefreshPhysicalSalesOnRecordPOS(rec, eid, dk);
  }catch(_){ }

  let nums = cashV2BlankCloseNumsPOS();
  try{
    if (rec){
      nums = cashV2ComputeCloseNumbers(rec, { preferDom: false });
    }
  }catch(err){
    console.warn('cashV2ComputeSnapshotPOS: computeCloseNumbers falló', err);
    nums = cashV2BlankCloseNumsPOS();
  }

  const snap = {
    version: 2,
    eventId: eid,
    dayKey: dk,
    status,
    totals: {
      NIO: {
        initial: Number(nums.NIO && nums.NIO.initial || 0),
        netMov: Number(nums.NIO && nums.NIO.net || 0),
        expected: Number(nums.NIO && nums.NIO.expected || 0),
        final: Number(nums.NIO && nums.NIO.final || 0),
        diff: Number(nums.NIO && nums.NIO.diff || 0)
      },
      USD: {
        initial: Number(nums.USD && nums.USD.initial || 0),
        netMov: Number(nums.USD && nums.USD.net || 0),
        expected: Number(nums.USD && nums.USD.expected || 0),
        final: Number(nums.USD && nums.USD.final || 0),
        diff: Number(nums.USD && nums.USD.diff || 0)
      }
    }
  };

  return snap;
}

function clearSummaryCashV2SnapshotPOS(){
  const card = document.getElementById('summary-cashv2-card');
  if (card) card.style.display = 'none';

  const tag = document.getElementById('summary-cashv2-status-tag');
  if (tag){
    tag.textContent = '—';
    tag.className = 'tag small';
  }

  const warn = document.getElementById('summary-cashv2-warn');
  if (warn){
    warn.style.display = 'none';
    const sm = warn.querySelector('small');
    if (sm) sm.textContent = 'Efectivo no está cerrado';
  }

  const setTxt = (id, val)=>{
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(val);
  };

  setTxt('summary-cashv2-initial-nio', '0');
  setTxt('summary-cashv2-net-nio', '0');
  setTxt('summary-cashv2-expected-nio', '0');
  setTxt('summary-cashv2-final-nio', '0');
  setTxt('summary-cashv2-initial-usd', '0');
  setTxt('summary-cashv2-net-usd', '0');
  setTxt('summary-cashv2-expected-usd', '0');
  setTxt('summary-cashv2-final-usd', '0');

  const dN = document.getElementById('summary-cashv2-diff-nio');
  const dU = document.getElementById('summary-cashv2-diff-usd');
  if (dN) cashV2SetDiffPill(dN, 0);
  if (dU) cashV2SetDiffPill(dU, 0);
}

async function renderSummaryCashV2SnapshotPOS({ eventId, dayKey }){
  const card = document.getElementById('summary-cashv2-card');
  if (!card) return;

  const eid = Number(eventId);
  const dk = dayKey ? safeYMD(dayKey) : '';
  if (!eid || !dk){
    clearSummaryCashV2SnapshotPOS();
    return;
  }

  const tag = document.getElementById('summary-cashv2-status-tag');
  const warn = document.getElementById('summary-cashv2-warn');

  const setTag = (text, cls)=>{
    if (!tag) return;
    tag.textContent = String(text || '—');
    tag.className = 'tag small' + (cls ? (' ' + cls) : '');
  };

  const setNum = (id, n)=>{
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = cashV2FmtInt(n);
  };

  let snap = null;
  try{ snap = await cashV2ComputeSnapshotPOS(eid, dk); }catch(err){
    console.warn('renderSummaryCashV2SnapshotPOS: compute snapshot falló', err);
    snap = null;
  }

  // Mostrar card
  card.style.display = 'block';

  const status = snap ? String(snap.status || 'MISSING').trim().toUpperCase() : 'MISSING';
  const isClosed = (status === 'CLOSED');

  // Tag + warning
  if (status === 'MISSING'){
    setTag('Sin registro', '');
    if (warn){
      warn.style.display = 'block';
      const sm = warn.querySelector('small');
      if (sm) sm.textContent = 'Efectivo no está cerrado (sin registro)';
    }
  } else {
    const ui = cashV2StatusToUiPOS(status);
    setTag(ui.text, ui.cls);
    if (warn){
      warn.style.display = isClosed ? 'none' : 'block';
      const sm = warn.querySelector('small');
      if (sm) sm.textContent = 'Efectivo no está cerrado';
    }
  }

  const t = snap ? (snap.totals || {}) : {};
  const nio = t.NIO || {};
  const usd = t.USD || {};

  setNum('summary-cashv2-initial-nio', nio.initial || 0);
  setNum('summary-cashv2-net-nio', nio.netMov || 0);
  setNum('summary-cashv2-expected-nio', nio.expected || 0);
  setNum('summary-cashv2-final-nio', nio.final || 0);
  setNum('summary-cashv2-initial-usd', usd.initial || 0);
  setNum('summary-cashv2-net-usd', usd.netMov || 0);
  setNum('summary-cashv2-expected-usd', usd.expected || 0);
  setNum('summary-cashv2-final-usd', usd.final || 0);

  const dN = document.getElementById('summary-cashv2-diff-nio');
  const dU = document.getElementById('summary-cashv2-diff-usd');
  if (dN) cashV2SetDiffPill(dN, nio.diff || 0);
  if (dU) cashV2SetDiffPill(dU, usd.diff || 0);
}



function getSummaryCloseDayKeyPOS(){
  const el = document.getElementById('summary-close-date');
  const v = (el && el.value) ? el.value : '';
  // Importante (Etapa 3): NO normalizar aquí con safeYMD, para poder bloquear fechas inválidas.
  // Fallback a día de venta (que ya está normalizado) solo si el input está vacío.
  return v || getSaleDayKeyPOS();
}

function clearSummaryCloseBlockerPOS(){
  const el = document.getElementById('summary-close-blocker');
  if (!el) return;
  el.style.display = 'none';
  el.innerHTML = '';
}

function fmtSignedPlain(n){
  const v = round2(Number(n || 0));
  if (!Number.isFinite(v)) return '0.00';
  return (v > 0 ? '+' : '') + fmt(v);
}

function showSummaryCloseBlockerPOS({ headline, diffNio, diffUsd, usdActive }){
  const el = document.getElementById('summary-close-blocker');
  if (!el) return;

  const line1 = headline || 'No se puede cerrar: hay validaciones pendientes.';
  const line2 = usdActive
    ? `Diferencia C$: ${fmtSignedPlain(diffNio)} | USD: ${fmtSignedPlain(diffUsd)}`
    : `Diferencia C$: ${fmtSignedPlain(diffNio)}`;

  el.style.display = 'block';
  el.innerHTML = '';

  const msg = document.createElement('div');
  msg.style.whiteSpace = 'pre-line';
  msg.textContent = line1;

  const diff = document.createElement('div');
  diff.style.marginTop = '6px';
  diff.textContent = line2;

  el.appendChild(msg);
  el.appendChild(diff);
}

function hideSummaryReturnBannerPOS(){
  const el = document.getElementById('summary-close-return');
  if (!el) return;
  el.style.display = 'none';
  el.innerHTML = '';
  delete el.dataset.forEventId;
  delete el.dataset.prevEventId;
}

async function showSummaryReturnBannerPOS({ currentEventId, prevEventId }){
  const el = document.getElementById('summary-close-return');
  if (!el) return;
  const prevEv = await getEventByIdSafe(prevEventId);
  if (!prevEv || prevEv.closedAt){
    hideSummaryReturnBannerPOS();
    return;
  }

  el.style.display = 'block';
  el.innerHTML = '';
  el.dataset.forEventId = String(currentEventId || '');
  el.dataset.prevEventId = String(prevEventId || '');

  const msg = document.createElement('div');
  msg.textContent = `Día cerrado. ¿Volver a ${prevEv.name || 'evento previo'}?`;

  const actions = document.createElement('div');
  actions.className = 'actions end';
  actions.style.marginTop = '8px';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-outline btn-pill';
  btn.textContent = 'Volver';
  btn.addEventListener('click', async (e)=>{
    e.preventDefault();
    // Etapa 2: limpiar cliente al cambiar evento
    await resetOperationalStateOnEventSwitchPOS();
    await setMeta('currentEventId', prevEventId);
hideSummaryReturnBannerPOS();
    await refreshEventUI();
    try{ await renderDay(); }catch(_){ }
    try{ await renderSummaryDailyCloseCardPOS(); }catch(_){ }
    try{ setTab('venta'); }catch(_){ }
  });

  actions.appendChild(btn);
  el.appendChild(msg);
  el.appendChild(actions);
}

async function onSummaryCloseDayPOS(){
  if (__A33_SUMMARY_MODE === 'archive'){
    showToast('Estás viendo un período archivado. Volvé a En vivo para cerrar el día.', 'error', 3500);
    return;
  }
  let selectedSummaryEventId = SUMMARY_EVENT_GLOBAL_POS;
  try{ selectedSummaryEventId = await getSelectedSummaryEventIdPOS(); }catch(_){ selectedSummaryEventId = SUMMARY_EVENT_GLOBAL_POS; }
  const evId = parseSummaryEventIdPOS(selectedSummaryEventId);
  if (!evId){
    showToast('GLOBAL es solo lectura. Selecciona un evento para cerrar el día.', 'error', 4500);
    return;
  }
  const ev = await getEventByIdPOS(evId);
  if (!ev){
    showToast('Evento no encontrado.', 'error', 4000);
    return;
  }
  const dayKey = getSummaryCloseDayKeyPOS();

  clearSummaryCloseBlockerPOS();

  // Confirmación obligatoria antes de cerrar (anti-error humano)
  {
    const msg = `¿Estás seguro que vas a cerrar el día “${dayKey}” del evento “${(ev.name||'Evento')}”?`;
    const ok = await showConfirmClosePOS({ title: 'Cerrar día', message: msg });
    if (!ok) return;
  }

  try{
    const r = await closeDailyPOS({ event: ev, dateKey: dayKey, source: 'SUMMARY' });
    const v = (r && r.closure && r.closure.version) ? Number(r.closure.version) : (r && r.lock && r.lock.lastClosureVersion ? Number(r.lock.lastClosureVersion) : null);
    if (r && r.already){
      const hint = (r && r.hint) ? (' ' + String(r.hint||'').trim()) : ' Reabrí el día si necesitás generar un nuevo cierre.';
      showToast(`Ya está cerrado${v ? ` (v${v})` : ''}.${hint}`, 'ok', 4500);
    } else {
      showToast(`Cierre guardado${v ? ` (v${v})` : ''}.`, 'ok', 4500);
    }
    try{ hideSummaryReturnBannerPOS(); }catch(_){ }
  }catch(err){
    console.error('onSummaryCloseDayPOS', err);
    showToast('No se pudo cerrar el día: ' + humanizeError(err), 'error', 5000);
  }
  try{ await updateSellEnabled(); }catch(e){}
  try{ await renderSummaryDailyCloseCardPOS(); }catch(e){}
}


async function onSummaryReopenDayPOS(){
  if (__A33_SUMMARY_MODE === 'archive'){
    showToast('Estás viendo un período archivado. Volvé a En vivo para reabrir.', 'error', 3500);
    return;
  }
  let selectedSummaryEventId = SUMMARY_EVENT_GLOBAL_POS;
  try{ selectedSummaryEventId = await getSelectedSummaryEventIdPOS(); }catch(_){ selectedSummaryEventId = SUMMARY_EVENT_GLOBAL_POS; }
  const evId = parseSummaryEventIdPOS(selectedSummaryEventId);
  if (!evId){
    showToast('GLOBAL es solo lectura. Selecciona un evento para reabrir el día.', 'error', 4500);
    return;
  }
  const ev = await getEventByIdPOS(evId);
  if (!ev){
    showToast('Evento no encontrado.', 'error', 4000);
    return;
  }
  const dayKey = getSummaryCloseDayKeyPOS();

  clearSummaryCloseBlockerPOS();

  try{
    await reopenDailyPOS({ event: ev, dateKey: dayKey, source: 'SUMMARY' });
    showToast('Día reabierto.', 'ok', 3500);
  }catch(err){
    console.error('onSummaryReopenDayPOS', err);
    showToast('No se pudo reabrir el día: ' + humanizeError(err), 'error', 5000);
  }
  try{ await updateSellEnabled(); }catch(e){}
  try{ await renderSummaryDailyCloseCardPOS(); }catch(e){}
}


function bindSummaryDailyClosePOS(){
  const dateEl = document.getElementById('summary-close-date');
  if (dateEl){
    dateEl.addEventListener('change', ()=>{
      try{ dateEl.dataset.userSet = '1'; }catch(_){ }
      renderSummaryDailyCloseCardPOS();
    });
  }

  // Selector de evento en Resumen (Cierre diario)
  const sumEv = document.getElementById('summary-close-event');
  if (sumEv){
    sumEv.addEventListener('change', ()=>{
      (async()=>{
        const valRaw = sumEv.value;
        const val = (valRaw == null || String(valRaw) === '') ? SUMMARY_EVENT_GLOBAL_POS : String(valRaw);
        await setSelectedSummaryEventIdPOS(val);
        // Recalcular Resumen (totales + tablas) según GLOBAL vs evento
        try{ await renderSummary(); }catch(e){ console.error('renderSummary (selector Resumen)', e); }
        try{ await renderSummaryDailyCloseCardPOS(); }catch(e){ }
      })();
    });
  }

  const btnClose = document.getElementById('btn-summary-close-day');
  if (btnClose){
    btnClose.addEventListener('click', ()=>{
      runWithSavingLockPOS({
        key: 'cierre del día',
        btnIds: ['btn-summary-close-day'],
        labelSaving: 'Guardando…',
        busyToast: 'Guardando cierre…',
        onError: (err)=> showPersistFailPOS('cierre del día', err),
        fn: onSummaryCloseDayPOS
      });
    });
  }

  const btnReopen = document.getElementById('btn-summary-reopen-day');
  if (btnReopen){
    btnReopen.addEventListener('click', ()=>{ onSummaryReopenDayPOS(); });
  }
}


// -----------------------------
// Resumen · Períodos: Cerrar Período + Archivo (snapshots)
// -----------------------------

const MONTHS_ES_POS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function pad3POS(n){
  const x = Number(n || 0);
  return String(Math.max(0, x)).padStart(3,'0');
}

function nowIsoPOS(){
  try{ return new Date().toISOString(); }catch(_){ return '' + Date.now(); }
}

function periodKeyFromDatePOS(d){
  try{
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2,'0');
    return `${y}-${m}`;
  }catch(_){
    return '';
  }
}

function getSummarySelectedPeriodKeyPOS(){
  const el = document.getElementById('summary-period');
  const v = (el && el.value) ? String(el.value).trim() : '';
  if (v && /^\d{4}-\d{2}$/.test(v)) return v;
  return periodKeyFromDatePOS(new Date());
}

function periodLabelPOS(periodKey){
  const m = Number(String(periodKey || '').slice(5,7));
  const y = String(periodKey || '').slice(0,4);
  const month = (m >= 1 && m <= 12) ? MONTHS_ES_POS[m-1] : 'Mes';
  return `${month} ${y}`.trim();
}

function periodFilePartPOS(periodKey){
  const m = Number(String(periodKey || '').slice(5,7));
  const y = String(periodKey || '').slice(0,4);
  const month = (m >= 1 && m <= 12) ? MONTHS_ES_POS[m-1] : 'Mes';
  return `${month}${y}`;
}

function setSummaryModeBadgePOS(){
  const badge = document.getElementById('summary-mode-badge');
  const btnBack = document.getElementById('btn-summary-back-live');
  if (badge){
    try{ badge.classList.remove('open','closed'); }catch(_){ }
    if (__A33_SUMMARY_MODE === 'archive' && __A33_ACTIVE_ARCHIVE){
      const a = __A33_ACTIVE_ARCHIVE || {};
      const seq = a.seqStr || pad3POS(a.seq || 0);
      const per = a.periodLabel || (a.snapshot && a.snapshot.periodLabel) || periodLabelPOS(a.periodKey || (a.snapshot && a.snapshot.periodKey) || '');
      badge.textContent = `ARCHIVO: ${per} — ${seq}`;
      try{ badge.classList.add('closed'); }catch(_){ }
    } else {
      if (__A33_SUMMARY_VIEW_MODE === 'all') badge.textContent = 'Todo';
      else badge.textContent = 'En vivo';
      try{ badge.classList.add('open'); }catch(_){ }
    }
  }
  if (btnBack){
    // Solo aparece cuando se está viendo un snapshot archivado
    btnBack.style.display = (__A33_SUMMARY_MODE === 'archive') ? 'inline-flex' : 'none';
  }

  // Estado visual del botón "Todo" (solo en vivo)
  syncSummaryAllButtonStatePOS();
}


function syncSummaryPeriodLabelPOS(){
  const lbl = document.getElementById('summary-period-label');
  const hint = document.getElementById('summary-period-hint');
  try{
    if (__A33_SUMMARY_MODE === 'archive'){
      if (lbl) lbl.textContent = '';
      if (hint) hint.textContent = 'Viendo un período archivado (snapshot). Acciones de cierre bloqueadas.';
      return;
    }
    if (__A33_SUMMARY_VIEW_MODE === 'all'){
      if (lbl) lbl.textContent = 'Todo';
      if (hint) hint.textContent = 'Mostrando todos los meses.';
      return;
    }
    const pk = getSummarySelectedPeriodKeyPOS();
    if (lbl) lbl.textContent = periodLabelPOS(pk);
    if (hint) hint.textContent = 'Filtrando ventas por mes (YYYY-MM).';
  }catch(_){ }
}

function openModalPOS(modalId){
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.style.display = 'flex';
}

function closeModalPOS(modalId){
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.style.display = 'none';
}

// Confirm modal reutilizable (iPad-friendly) para acciones destructivas en POS
function showConfirmClosePOS({ title, message } = {}){
  return new Promise((resolve)=>{
    const modalId = 'pos-confirm-modal';
    const modal = document.getElementById(modalId);
    const elTitle = document.getElementById('pos-confirm-title');
    const elMsg = document.getElementById('pos-confirm-message');
    const btnCancel = document.getElementById('pos-confirm-cancel');
    const btnConfirm = document.getElementById('pos-confirm-confirm');
    if (!modal || !btnCancel || !btnConfirm || !elMsg){
      console.warn('showConfirmClosePOS: modal incompleto');
      resolve(false);
      return;
    }

    const safeTitle = (title != null) ? String(title) : '';
    const safeMsg = (message != null) ? String(message) : '';

    if (elTitle){
      elTitle.textContent = safeTitle || 'Confirmación';
    }
    elMsg.textContent = safeMsg;

    let done = false;
    const cleanup = ()=>{
      try{ modal.onclick = null; }catch(_){ }
      try{ btnCancel.onclick = null; }catch(_){ }
      try{ btnConfirm.onclick = null; }catch(_){ }
      try{ document.removeEventListener('keydown', onKey, true); }catch(_){ }
    };
    const finish = (v)=>{
      if (done) return;
      done = true;
      cleanup();
      try{ closeModalPOS(modalId); }catch(_){ }
      resolve(!!v);
    };
    const onKey = (e)=>{
      if (e && e.key === 'Escape'){
        try{ e.preventDefault(); }catch(_){ }
        finish(false);
      }
    };

    btnCancel.onclick = ()=>finish(false);
    btnConfirm.onclick = ()=>finish(true);

    // Tap fuera cancela (patrón móvil)
    modal.onclick = (e)=>{
      if (e && e.target === modal) finish(false);
    };

    try{ document.addEventListener('keydown', onKey, true); }catch(_){ }
    openModalPOS(modalId);
    // Importante: NO auto-focus en Confirmar
    try{ btnCancel.focus({ preventScroll: true }); }catch(_){ }
  });
}

function setClosePeriodErrorPOS(msg){
  const el = document.getElementById('summary-close-error');
  if (!el) return;
  el.style.whiteSpace = 'pre-wrap';
  if (!msg){
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.style.whiteSpace = 'pre-line';
  el.textContent = msg;
}

async function listOpenEventsPOS(){
  const events = await getAll('events');
  return (events || []).filter(ev => ev && !ev.closedAt);
}


function toValidEventIdPOS(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const id = Math.floor(n);
  return (id > 0) ? id : null;
}

function isDateKeyInPeriodPOS(dateKey, periodKey){
  const d = String(dateKey || '');
  const pk = String(periodKey || '').trim();
  return !!(pk && d && d.startsWith(pk + '-'));
}

function formatPendingEventsInlinePOS(events, maxItems){
  const arr = Array.isArray(events) ? events : [];
  const max = Number(maxItems || 6) || 6;
  const names = arr.map(ev => (ev && ev.name) ? String(ev.name) : (ev && ev.id != null ? ('Evento #' + ev.id) : 'Evento'));
  const shown = names.slice(0, max);
  const more = Math.max(0, names.length - shown.length);
  return shown.join(', ') + (more ? `… +${more}` : '');
}

async function collectRelevantEventIdsForPeriodPOS(periodKey, salesInPeriod){
  const ids = new Set();
  const pk = String(periodKey || '').trim();
  if (!pk) return ids;

  let sales = Array.isArray(salesInPeriod) ? salesInPeriod : null;
  if (!sales){
    try{
      const all = await getAll('sales');
      sales = (all || []).filter(s => isSaleInPeriodPOS(s, pk));
    }catch(_){ sales = []; }
  }

  for (const s of (sales || [])){
    const id = toValidEventIdPOS(s && s.eventId);
    if (id != null) ids.add(id);
  }

  // Cierres/candados del período (si existen) para no perder eventos sin ventas
  try{
    const locks = await getAll('dayLocks');
    for (const l of (locks || [])){
      if (!l) continue;
      if (!isDateKeyInPeriodPOS(l.dateKey, pk)) continue;
      const id = toValidEventIdPOS(l.eventId);
      if (id != null) ids.add(id);
    }
  }catch(_){ }

  try{
    const closes = await getAll('dailyClosures');
    for (const c of (closes || [])){
      if (!c) continue;
      if (!isDateKeyInPeriodPOS(c.dateKey, pk)) continue;
      const id = toValidEventIdPOS(c.eventId);
      if (id != null) ids.add(id);
    }
  }catch(_){ }

  return ids;
}

async function computeClosePeriodGatekeeperPOS(periodKey, opts){
  const pk = String(periodKey || '').trim();

  // 1) Modo / período válido
  if (__A33_SUMMARY_MODE === 'archive'){
    return {
      ok: false,
      reason: 'Viendo un período archivado (snapshot). Volvé a En vivo para cerrar períodos.',
      hint: 'Viendo un período archivado (snapshot).'
    };
  }
  if (__A33_SUMMARY_VIEW_MODE === 'all'){
    return {
      ok: false,
      reason: 'Selecciona un período (mes) para cerrar.',
      hint: 'Mostrando todos los meses. Selecciona un mes para cerrar período.'
    };
  }
  if (!/^\d{4}-\d{2}$/.test(pk)){
    return {
      ok: false,
      reason: 'Selecciona un período válido (YYYY-MM) para cerrar.',
      hint: 'Selecciona un período válido (YYYY-MM) para cerrar.'
    };
  }

  // 2) Ya archivado
  const existing = await getArchiveByPeriodKeyPOS(pk);
  if (existing){
    const seqTxt = (existing.seqStr || existing.seq || '').toString();
    return {
      ok: false,
      existing,
      reason: `Este período ya fue archivado (Seq ${seqTxt}).
No se reescribe el histórico.`,
      hint: `Período ya cerrado (Seq ${seqTxt}).`
    };
  }

  // 3) Eventos relevantes del período
  const salesInPeriod = opts && Array.isArray(opts.salesInPeriod) ? opts.salesInPeriod : null;
  const ids = await collectRelevantEventIdsForPeriodPOS(pk, salesInPeriod);

  // Si no hay eventos relevantes (o solo legacy sin eventId), no bloquea el cierre.
  if (!ids.size){
    return { ok: true, pending: [], hint: '' };
  }

  const eventsAll = (opts && Array.isArray(opts.eventsAll)) ? opts.eventsAll : await getAll('events');
  const map = new Map();
  for (const ev of (eventsAll || [])){
    if (ev && ev.id != null) map.set(Number(ev.id), ev);
  }

  const pending = [];
  for (const id of ids){
    const ev = map.get(Number(id));
    if (!ev) continue; // no bloquear por eventos inexistentes
    if (!ev.closedAt) pending.push(ev);
  }

  if (pending.length){
    const lines = pending.map(ev => `- ${(ev.name || ('Evento #' + ev.id))}`).join('\n');
    const short = formatPendingEventsInlinePOS(pending, 6);
    return {
      ok: false,
      pending,
      reason: `No se puede cerrar el período. Eventos del período sin cerrar:
${lines}

Recuerda: Día cerrado no es evento cerrado.`,
      hint: `No se puede cerrar período: faltan eventos por cerrar: ${short}.`
    };
  }

  return { ok: true, pending: [], hint: '' };
}

async function applyClosePeriodGatekeeperUI_POS(opts){
  if (__A33_SUMMARY_MODE === 'archive') return;
  try{ syncSummaryPeriodLabelPOS(); }catch(_){ }
  const btn = document.getElementById('btn-summary-close-period');
  if (!btn) return;

  const hintEl = document.getElementById('summary-period-hint');

  // Guardar hint default para poder restaurarlo al quedar OK
  try{
    if (hintEl && !hintEl.dataset.defaultText){
      hintEl.dataset.defaultText = String(hintEl.textContent || '');
    }
  }catch(_){ }

  // Modo CONSOLIDADO (solo lectura): no permitir acciones de cierre
  try{
    if (typeof isSummaryConsolidatedViewActivePOS === 'function' && isSummaryConsolidatedViewActivePOS()){
      try{ btn.disabled = true; }catch(_){ }
      if (hintEl){
        hintEl.textContent = 'CONSOLIDADO es solo lectura. Volvé a Archivo normal para cerrar períodos.';
      }
      return;
    }
  }catch(_){ }

  // Guard obligatorio: Cerrar período SOLO desde GLOBAL (cierre consolidado)
  let selectedSummaryEventId = null;
  try{
    selectedSummaryEventId = (opts && opts.selectedSummaryEventId) ? String(opts.selectedSummaryEventId) : await getSelectedSummaryEventIdPOS();
  }catch(err){
    selectedSummaryEventId = null;
  }
  if (!isSummaryGlobalPOS(selectedSummaryEventId)){
    try{ btn.disabled = true; }catch(_){ }
    if (hintEl){
      hintEl.textContent = selectedSummaryEventId
        ? 'Para cerrar período, pon Resumen en GLOBAL (consolida TODOS los eventos del mes).'
        : 'No se pudo leer el selector de evento. Recarga y pon Resumen en GLOBAL para cerrar período.';
    }
    return;
  }

  const pk = (opts && opts.periodKey) ? String(opts.periodKey) : getSummarySelectedPeriodKeyPOS();
  const gate = await computeClosePeriodGatekeeperPOS(pk, opts || {});

  // En Archivo, applySummaryArchiveGuardsPOS ya oculta el botón.
  if (!gate.ok){
    try{ btn.disabled = true; }catch(_){ }
    if (hintEl && gate.hint){
      hintEl.textContent = gate.hint;
    }
    return;
  }

  // OK
  try{ btn.disabled = false; }catch(_){ }

  // Restaurar hint por defecto (si existe)
  try{
    if (hintEl && hintEl.dataset && hintEl.dataset.defaultText != null){
      hintEl.textContent = String(hintEl.dataset.defaultText || '');
    }
  }catch(_){ }
}

async function getArchiveByPeriodKeyPOS(periodKey){
  const all = await getAll('summaryArchives');
  const pk = String(periodKey || '').trim();
  return (all || []).find(a => a && String(a.periodKey || '').trim() === pk) || null;
}

function isSaleInPeriodPOS(s, periodKey){
  const d = String((s && s.date) || '');
  return !!(periodKey && d.startsWith(periodKey + '-'));
}

// Resumen (export): dataset por período alineado a GLOBAL vs EVENTO.
// Nota: por diseño, ventas sin eventId solo entran en GLOBAL.
async function computeSummaryDataForPeriodPOS(periodKey, selectedSummaryEventId){
  const salesAll = await getAll('sales');
  const eventsAll = await getAll('events');
  const products = await getAll('products');

  let sales = (salesAll || []).filter(s => isSaleInPeriodPOS(s, periodKey));

  // Filtro por evento (GLOBAL vs EVENTO) — mismo criterio que la pantalla.
  // Compat: ventas sin eventId solo cuentan en GLOBAL.
  try{
    const evId = parseSummaryEventIdPOS(selectedSummaryEventId);
    if (evId != null){
      sales = (sales || []).filter(s => (s && s.eventId != null && Number(s.eventId) === evId));
    }
  }catch(_){ }
  const events = (eventsAll || []);

  const productById = new Map();
  const productByName = new Map();
  for (const p of (products || [])){
    if (!p) continue;
    if (p.id != null) productById.set(Number(p.id), p);
    if (p.name) productByName.set(String(p.name), p);
  }

  const isCourtesySale = (s) => !!(s && (s.courtesy || s.isCourtesy));
  const normalizeCourtesyProductName = (name) => String(name || '—').replace(/\s*\(Cortesía\)\s*$/i, '').trim() || '—';

  const getLineCost = (s) => getSaleLineCostSnapshotPOS(s);

  const getListUnitPrice = (s) => {
    if (!s) return 0;
    const unit = Number(s.unitPrice || 0);
    if (unit > 0) return unit;

    const pid = (s.productId != null) ? Number(s.productId) : null;
    if (pid != null && productById.has(pid)){
      const p = productById.get(pid);
      const pr = Number(p && p.price) || 0;
      if (pr > 0) return pr;
    }

    const n = normalizeCourtesyProductName(s.productName || '');
    if (n && productByName.has(n)){
      const p = productByName.get(n);
      const pr = Number(p && p.price) || 0;
      if (pr > 0) return pr;
    }

    return 0;
  };

  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){
    if (b && b.id != null) bankMap.set(Number(b.id), b.name || '');
  }

  const transferByBank = new Map();

  let grand = 0;
  let discountTotal = 0;
  let grandCost = 0;
  let grandProfit = 0;

  let courtesyCost = 0;
  let courtesyQty = 0;
  let courtesyEquiv = 0;
  let courtesyTx = 0;
  const courtesyByProd = new Map();

  const byDay = new Map();
  const byProd = new Map();
  const byDiscount = new Map();
  const byPay = new Map();
  const byEvent = new Map();

  for (const s of (sales || [])){
    if (!s) continue;
    const total = Number(s.total || 0);
    const courtesy = isCourtesySale(s);

    if (!courtesy){
      grand += total;
      const saleDiscount = getSummarySaleDiscountSignedTotalPOS(s);
      discountTotal += saleDiscount;
      addSummaryDiscountAggPOS(byDiscount, getSaleProductNameSnapshotPOS(s), saleDiscount);
      byDay.set(s.date, (byDay.get(s.date) || 0) + total);
      addSummaryProductAggPOS(byProd, getSaleProductNameSnapshotPOS(s), total, getSummarySaleQtyPOS(s), true);
      const payKey = normalizePaymentMethodPOS(s.payment || 'efectivo') || 'efectivo';
      byPay.set(payKey, (byPay.get(payKey) || 0) + total);
      byEvent.set(s.eventName || 'General', (byEvent.get(s.eventName || 'General') || 0) + total);

      if (normalizePaymentMethodPOS(s.payment || '') === 'transferencia'){
        const label = getSaleBankLabel(s, bankMap);
        const cur = transferByBank.get(label) || { total: 0, count: 0 };
        cur.total += total;
        cur.count += 1;
        transferByBank.set(label, cur);
      }

      const lineCost = getLineCost(s);
      let lineProfit = 0;
      if (typeof s.lineProfit === 'number' && Number.isFinite(s.lineProfit)) {
        lineProfit = Number(s.lineProfit || 0);
      } else {
        lineProfit = total - lineCost;
      }
      grandCost += lineCost;
      grandProfit += lineProfit;
    } else {
      courtesyTx += 1;
      const qRaw = Number(s.qty || 0);
      const absQty = Math.abs(qRaw);
      const sign = (s.isReturn || qRaw < 0) ? -1 : 1;

      courtesyQty += absQty;

      const lineCost = getLineCost(s);
      courtesyCost += lineCost;

      const listUnit = getListUnitPrice(s);
      const eq = sign * absQty * listUnit;
      courtesyEquiv += eq;

      const pname = normalizeCourtesyProductName(getSaleProductNameSnapshotPOS(s));
      const prev = courtesyByProd.get(pname) || { qty: 0, cost: 0, equiv: 0 };
      prev.qty += absQty;
      prev.cost += lineCost;
      prev.equiv += eq;
      courtesyByProd.set(pname, prev);
    }
  }

  const profitAfterCourtesy = grandProfit - courtesyCost;

  // Totales por evento (en el período) + status de evento
  const eventTotals = new Map();
  for (const [k, v] of byEvent.entries()) eventTotals.set(k, v);

  // Transferencias por banco (ordenadas desc)
  const transferList = Array.from(transferByBank.entries()).map(([bank, obj]) => ({ bank, total: obj.total || 0, count: obj.count || 0 }))
    .sort((a,b)=> (Number(b.total||0) - Number(a.total||0)));

  const courtesyList = Array.from(courtesyByProd.entries()).map(([name, o]) => ({ name, qty: o.qty || 0, cost: o.cost || 0, equiv: o.equiv || 0 }))
    .sort((a,b)=> (Number(b.cost||0) - Number(a.cost||0)));

  const discountList = summaryDiscountRowsFromMapPOS(byDiscount);

  // Helpers para Excel/listas ordenadas
  const sortMapDesc = (m) => Array.from(m.entries()).map(([k,v])=>({ key:k, val:v }))
    .sort((a,b)=> (Number(b.val||0) - Number(a.val||0)));
  const sortMapDateAsc = (m) => Array.from(m.entries()).map(([k,v])=>({ key:k, val:v }))
    .sort((a,b)=> String(a.key).localeCompare(String(b.key)));
  const sortProductAggByTotal = (m) => summaryProductRowsFromMapPOS(m);

  return {
    periodKey,
    periodLabel: periodLabelPOS(periodKey),
    metrics: {
      grand,
      discountTotal,
      grandCost,
      grandProfit,
      courtesyCost,
      profitAfterCourtesy,
      courtesyQty,
      courtesyTx,
      courtesyEquiv
    },
    byEvent: sortMapDesc(byEvent),
    byDay: sortMapDateAsc(byDay),
    byProd: sortProductAggByTotal(byProd),
    byDiscount: discountList,
    byPay: sortMapDesc(byPay),
    transferByBank: transferList,
    courtesyByProd: courtesyList,
    events: events
  };
}

function buildSummarySheetsFromDataPOS(data){
  const sheets = [];
  const m = data.metrics || {};

  // Hoja Resumen
  const r = [];
  r.push(['Período', data.periodLabel || '']);
  r.push(['PeriodKey', data.periodKey || '']);
  r.push(['Exportado', nowIsoPOS()]);
  r.push([]);
  r.push(['Métrica', 'Monto C$']);
  r.push(['Venta neta', m.grand || 0]);
  r.push(['Descuentos', m.discountTotal || 0]);
  r.push(['Costos de ventas', m.grandCost || 0]);
  r.push(['Utilidad bruta', m.grandProfit || 0]);
  r.push(['Cortesías (Costo real)', m.courtesyCost || 0]);
  r.push(['Utilidad después de cortesías', m.profitAfterCourtesy || 0]);
  r.push([]);
  r.push(['Cortesías (unidades)', m.courtesyQty || 0]);
  r.push(['Cortesías (movimientos)', m.courtesyTx || 0]);
  r.push(['Cortesías (equivalente ventas)', m.courtesyEquiv || 0]);
  sheets.push({ name: 'Resumen', rows: r });

  // Hoja PorEvento
  const eRows = [['Evento','Total C$']];
  for (const it of (data.byEvent || [])) eRows.push([it.key, it.val || 0]);
  sheets.push({ name: 'PorEvento', rows: eRows });

  // Hoja PorDia
  const dRows = [['Fecha','Total C$']];
  for (const it of (data.byDay || [])) dRows.push([it.key, it.val || 0]);
  sheets.push({ name: 'PorDia', rows: dRows });

  // Hoja PorProducto
  const pRows = [['Producto','Vendido','Total C$']];
  for (const it of sortSummaryProductItemsByTotalPOS(data.byProd || [])){
    const q = summaryProductItemQtyPOS(it);
    pRows.push([summaryProductItemNamePOS(it), q.qtyKnown ? q.qty : '', summaryProductItemTotalPOS(it)]);
  }
  sheets.push({ name: 'PorProducto', rows: pRows });

  // Hoja Descuentos
  const discRows = [['Producto','Total descuento C$']];
  for (const it of (data.byDiscount || [])){
    discRows.push([summaryDiscountItemNamePOS(it), summaryDiscountItemTotalPOS(it)]);
  }
  sheets.push({ name: 'Descuentos', rows: discRows });

  // Hoja PorPago
  const payRows = [['Método','Total C$']];
  for (const it of (data.byPay || [])) payRows.push([getPaymentMethodLabelPOS(it.key), it.val || 0]);
  sheets.push({ name: 'PorPago', rows: payRows });

  // Hoja TransferenciasBanco
  const tb = [['Banco','Total C$','Transacciones']];
  for (const it of (data.transferByBank || [])) tb.push([it.bank, it.total || 0, it.count || 0]);
  sheets.push({ name: 'TransferenciasBanco', rows: tb });

  // Hoja Cortesias
  const cRows = [['Producto','Cantidad','Costo total C$','Equivalente C$']];
  for (const it of (data.courtesyByProd || [])) cRows.push([it.name, it.qty || 0, it.cost || 0, it.equiv || 0]);
  sheets.push({ name: 'Cortesias', rows: cRows });

  return sheets;
}

function writeWorkbookFromSheetsPOS(filename, sheets){
  if (typeof XLSX === 'undefined'){
    throw new Error('No se pudo generar el archivo de Excel (librería XLSX no cargada). Si estás sin conexión por primera vez, abrí el POS con internet una vez para cachear todo y reintentá.');
  }
  const wb = XLSX.utils.book_new();
  for (const sh of (sheets || [])){
    const sheetName = sh.name || 'Hoja';
    const rows = (String(sheetName) === 'PorProducto')
      ? sortSummaryPorProductoSheetRowsPOS(sh.rows || [])
      : ((String(sheetName) === 'Descuentos') ? sortSummaryDescuentosSheetRowsPOS(sh.rows || []) : (sh.rows || []));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  XLSX.writeFile(wb, filename);
}

async function exportSummaryPeriodExcelPOS({ periodKey, filename }){
  const data = await computeSummaryDataForPeriodPOS(periodKey);
  const sheets = buildSummarySheetsFromDataPOS(data);
  writeWorkbookFromSheetsPOS(filename, sheets);
  return { sheets, data };
}

async function resetOperationalStoresAfterArchivePOS(){
  // Solo stores operativos (no products, no banks, no meta, no summaryArchives)
  // IMPORTANTE: debe conservar “Evento Maestro / Grupos” (nombres + orden).
  // Checklist manual (obligatorio):
  // 1) Tener grupos “2026” y “Emprendedores” con eventos adentro.
  // 2) Hacer ventas + cierre + movimientos.
  // 3) Resumen > Cerrar período.
  // 4) Verificar: ventas/cierres/movimientos se borraron; grupos siguen igual (nombres + orden);
  //    puedes crear eventos nuevos y seguir usando esos grupos.

  if (!db) await openDB();

  // --- Snapshot conservador de grupos/orden (se deriva de eventos si el catálogo aún no existe)
  let evsForGroups = [];
  try{ evsForGroups = await getAll('events'); }catch(_){ evsForGroups = []; }
  try{ ensureGroupCatalogFromEventsPOS(evsForGroups); }catch(_){ }
  const groupsSnap = snapshotGroupsPOS();
  const groupsCount = Array.isArray(groupsSnap.catalog) ? groupsSnap.catalog.length : 0;

  // --- Limpiar localStorage operativo (sin “lanzallamas”)
  // Regla: si hay duda, NO se borra.
  const rm = (k)=>{
    try{
      if (window.A33Storage && typeof A33Storage.removeItem === 'function') A33Storage.removeItem(k, 'local');
      else localStorage.removeItem(k);
    }catch(_){ }
  };
  rm(A33_PENDING_SALE_UID_KEY);
  rm(A33_PENDING_SALE_FP_KEY);
  rm(A33_PENDING_SALE_AT_KEY);
// --- Limpiar stores operativos de forma ATÓMICA
  const stores = ['sales','inventory','dayLocks','dailyClosures','posRemindersIndex'];
  try{
    await clearStoresAtomicPOS(stores);
  }catch(err){
    // Restaurar snapshot de grupos por si algún paso tocó keys por accidente
    try{ restoreGroupsPOS(groupsSnap); }catch(_){ }
    throw err;
  }

  // Reset meta.currentEventId (sin tocar el consecutivo de períodos)
  try{ await setMeta('currentEventId', null); }catch(e){}

  // Reforzar grupos (por si se tocó algo): restaurar catálogo/ocultos/último
  try{ restoreGroupsPOS(groupsSnap); }catch(_){ }

  return { groupsCount };
}

async function openSummaryClosePeriodModalPOS(){
  if (isSummaryConsolidatedViewActivePOS()){
    showToast('CONSOLIDADO es solo lectura. Volvé a Archivo normal para cerrar períodos.', 'error', 4000);
    return;
  }
  if (__A33_SUMMARY_MODE === 'archive'){
    showToast('Estás viendo un período archivado. Volvé a En vivo para cerrar períodos.', 'error', 3500);
    return;
  }

  // Guard obligatorio: Cerrar período SOLO desde GLOBAL (cierre consolidado)
  let selectedSummaryEventId = null;
  try{
    selectedSummaryEventId = await getSelectedSummaryEventIdPOS();
  }catch(err){
    showToast('No se pudo leer el selector de evento. Volvé a Resumen y elegí GLOBAL.', 'error', 4500);
    return;
  }
  if (!isSummaryGlobalPOS(selectedSummaryEventId)){
    showToast('Cierre de período solo desde GLOBAL (consolida TODOS los eventos del mes).', 'error', 4000);
    return;
  }

  if (__A33_SUMMARY_VIEW_MODE === 'all'){
    showToast('Selecciona un período para cerrar.', 'error', 3500);
    return;
  }
  setClosePeriodErrorPOS('');

  // Autocompletar período actual si está vacío
  const periodKey = getSummarySelectedPeriodKeyPOS();
  const lbl = document.getElementById('summary-close-period-label');
  if (lbl) lbl.textContent = periodLabelPOS(periodKey);
  const inp = document.getElementById('summary-close-name');
  if (inp && !String(inp.value||'').trim()){
    inp.value = `Período ${periodLabelPOS(periodKey)}`;
  }

  const btnConfirm = document.getElementById('summary-close-confirm');
  const btnExport = document.getElementById('summary-close-export');

  // Gatekeeper (eventos relevantes del período + archive existente)
  const gate = await computeClosePeriodGatekeeperPOS(periodKey, null);
  if (!gate.ok){
    setClosePeriodErrorPOS(gate.reason || 'No se puede cerrar el período.');
    if (btnConfirm) btnConfirm.disabled = true;
    if (btnExport) btnExport.disabled = true;
  } else {
    if (btnConfirm) btnConfirm.disabled = false;
    if (btnExport) btnExport.disabled = false;
  }

  openModalPOS('summary-close-modal');
}


function closeSummaryClosePeriodModalPOS(){
  closeModalPOS('summary-close-modal');
}

async function confirmClosePeriodPOS(){
  if (isSummaryConsolidatedViewActivePOS()){
    showToast('CONSOLIDADO es solo lectura. No se puede cerrar/archivar desde esa vista.', 'error', 4000);
    return;
  }
  if (__A33_SUMMARY_MODE === 'archive'){
    showToast('Estás viendo un período archivado. Volvé a En vivo para cerrar.', 'error', 3500);
    return;
  }

  if (__A33_SUMMARY_VIEW_MODE === 'all'){
    setClosePeriodErrorPOS('Selecciona un período para cerrar.');
    showToast('Selecciona un período para cerrar.', 'error', 3500);
    return;
  }

  // Guard obligatorio: Cerrar período SOLO desde GLOBAL (cierre consolidado)
  let selectedSummaryEventId = null;
  try{
    selectedSummaryEventId = await getSelectedSummaryEventIdPOS();
  }catch(err){
    setClosePeriodErrorPOS('No se pudo leer el selector de evento. Volvé a Resumen y elegí GLOBAL.');
    showToast('No se pudo leer el selector de evento. Volvé a Resumen y elegí GLOBAL.', 'error', 4500);
    return;
  }
  if (!isSummaryGlobalPOS(selectedSummaryEventId)){
    setClosePeriodErrorPOS('Cierre de período solo desde GLOBAL (consolida TODOS los eventos del mes).');
    showToast('Cierre de período solo desde GLOBAL (consolida TODOS los eventos del mes).', 'error', 4000);
    return;
  }

  // Confirmación obligatoria antes de cerrar/archivar el período (anti-error humano)
  {
    const periodKey = getSummarySelectedPeriodKeyPOS();
    const msg = `¿Estás seguro que vas a cerrar el período “${periodLabelPOS(periodKey)}”?`;
    const ok = await showConfirmClosePOS({ title: 'Cerrar período', message: msg });
    if (!ok) return;
  }

  await runWithSavingLockPOS({
    key: 'closePeriod',
    btnIds: ['summary-close-confirm','summary-close-export','summary-close-cancel'],
    labelSaving: 'Procesando…',
    busyToast: 'Procesando…',
    onError: (err)=>{
      console.error('closePeriod fatal', err);
      setClosePeriodErrorPOS('Error al cerrar período (no se borró nada).\n\nDetalle: ' + humanizeError(err));
    },
    fn: async ()=>{
      const periodKey = getSummarySelectedPeriodKeyPOS();
      const gate = await computeClosePeriodGatekeeperPOS(periodKey, null);
      if (!gate.ok){
        setClosePeriodErrorPOS(gate.reason || 'No se puede cerrar el período.');
        return;
      }

      // Seq persistente
      let lastSeq = 0;
      try{ lastSeq = Number(await getMeta('periodArchiveSeq') || 0) || 0; }catch(e){ lastSeq = 0; }
      const seq = lastSeq + 1;
      const seqStr = pad3POS(seq);
      const fileName = `${seqStr}-${periodFilePartPOS(periodKey)}.xlsx`;

      // Export FORZADO (si falla, NO se archiva)
      let sheets = null;
      let exportData = null;
      try{
        const r = await exportSummaryPeriodExcelPOS({ periodKey, filename: fileName });
        sheets = r.sheets;
        exportData = r.data;
      }catch(err){
        console.error('Export Excel forzado falló', err);
        setClosePeriodErrorPOS('No se pudo exportar el Excel. Sin Excel, no hay cierre de período.\n\nDetalle: ' + humanizeError(err));
        return;
      }

      const createdAt = Date.now();
      const archive = {
        id: `PA-${Date.now()}-${Math.floor(Math.random()*1e6)}`,
        seq,
        seqStr,
        periodKey,
        periodLabel: periodLabelPOS(periodKey),
        name: (document.getElementById('summary-close-name')?.value || '').toString().trim() || `Período ${periodLabelPOS(periodKey)}`,
        fileName,
        createdAt,
        exportedAt: createdAt,
        snapshot: {
          periodKey,
          periodLabel: periodLabelPOS(periodKey),
          sheets,
          metrics: (exportData && exportData.metrics) ? exportData.metrics : null
        }
      };

      try{
        await put('summaryArchives', archive);
      }catch(err){
        console.error('No se pudo guardar el archive', err);
        setClosePeriodErrorPOS('Se exportó el Excel, pero NO se pudo guardar el snapshot del período.\nNo se hará el reset para evitar perder datos.\n\nDetalle: ' + humanizeError(err));
        return;
      }

      // Invalida caches livianos de Archivo/Consolidado tan pronto el snapshot existe
      try{ bumpConsolArchRevPOS(); }catch(_){ }
      try{ bumpConsolSalesRevPOS(periodKey); }catch(_){ }
      try{ clearConsolLiveCachePOS(periodKey); }catch(_){ }

      try{
        await setMeta('periodArchiveSeq', seq);
      }catch(err){
        // El snapshot ya existe; evitamos reset por seguridad, pero dejamos caches coherentes.
        console.error('No se pudo actualizar periodArchiveSeq', err);
        setClosePeriodErrorPOS('Se exportó el Excel y se guardó el snapshot, pero NO se pudo actualizar el contador de secuencia.\nNo se hará el reset para evitar perder datos.\n\nDetalle: ' + humanizeError(err));
        return;
      }

      // Reset a 0 (selectivo y conservador)
      let resetRes = null;
      try{
        resetRes = await resetOperationalStoresAfterArchivePOS();
      }catch(err){
        console.error('Reset falló', err);
        setClosePeriodErrorPOS('Error al cerrar período (no se borró nada).\n\nDetalle: ' + humanizeError(err));
        return;
      }

      closeSummaryClosePeriodModalPOS();
      const gc = (resetRes && Number(resetRes.groupsCount)) || 0;
      showToast(`Período cerrado ✅ · Estructura conservada: Evento Maestro/Grupos · Grupos: ${gc}`, 'ok', 4500);

      try{ await refreshEventUI(); }catch(e){}
      try{ await renderDay(); }catch(e){}
      try{ await renderSummary(); }catch(e){}
      try{ await renderEventos(); }catch(e){}
      try{ await renderInventario(); }catch(e){}
    }
  });
}

async function manualExportClosePeriodPOS(){
  if (isSummaryConsolidatedViewActivePOS()){
    showToast('CONSOLIDADO es solo lectura. No se puede exportar desde esa vista.', 'error', 4000);
    return;
  }

  if (__A33_SUMMARY_MODE === 'archive'){
    showToast('Estás viendo un período archivado. Volvé a En vivo para exportar.', 'error', 3500);
    return;
  }
  if (__A33_SUMMARY_VIEW_MODE === 'all'){
    setClosePeriodErrorPOS('Selecciona un período para exportar.');
    showToast('Selecciona un período para exportar.', 'error', 3500);
    return;
  }


  // Guard obligatorio: export de cierre SOLO desde GLOBAL (mismo criterio que Cerrar período)
  let selectedSummaryEventId = null;
  try{
    selectedSummaryEventId = await getSelectedSummaryEventIdPOS();
  }catch(err){
    setClosePeriodErrorPOS('No se pudo leer el selector de evento. Volvé a Resumen y elegí GLOBAL.');
    showToast('No se pudo leer el selector de evento. Volvé a Resumen y elegí GLOBAL.', 'error', 4500);
    return;
  }
  if (!isSummaryGlobalPOS(selectedSummaryEventId)){
    setClosePeriodErrorPOS('Export de cierre solo desde GLOBAL (consolida TODOS los eventos del mes).');
    showToast('Export de cierre solo desde GLOBAL (consolida TODOS los eventos del mes).', 'error', 4000);
    return;
  }

  const periodKey = getSummarySelectedPeriodKeyPOS();
  let lastSeq = 0;
  try{ lastSeq = Number(await getMeta('periodArchiveSeq') || 0) || 0; }catch(e){ lastSeq = 0; }
  const seq = lastSeq + 1;
  const seqStr = pad3POS(seq);
  const fileName = `${seqStr}-${periodFilePartPOS(periodKey)}.xlsx`;
  try{
    await exportSummaryPeriodExcelPOS({ periodKey, filename: fileName });
    showToast('Excel exportado.', 'ok', 2500);
  }catch(err){
    console.error('manual export close period', err);
    setClosePeriodErrorPOS('No se pudo exportar el Excel.\n\nDetalle: ' + humanizeError(err));
  }
}

function fmtDateTimePOS(ts){
  try{
    const d = new Date(ts);
    return d.toLocaleString('es-NI', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  }catch(_){
    return String(ts || '');
  }
}

function renderSummaryArchivesTablePOS(list){
  const tbody = document.querySelector('#tbl-summary-archives tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const rows = (list || []).slice();
  if (!rows.length){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="muted">No hay períodos archivados.</td>';
    tbody.appendChild(tr);
    return;
  }

  for (const a of rows){
    const tr = document.createElement('tr');

    const tdSeq = document.createElement('td');
    tdSeq.textContent = a.seqStr || pad3POS(a.seq || 0);

    const tdPer = document.createElement('td');
    tdPer.textContent = a.periodLabel || periodLabelPOS(a.periodKey || '');

    const tdWhen = document.createElement('td');
    tdWhen.textContent = fmtDateTimePOS(a.createdAt || a.exportedAt || '');

    const tdAct = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'archive-actions';

    const btnView = document.createElement('button');
    btnView.type = 'button';
    btnView.className = 'btn-pill btn-pill-mini btn-ok';
    btnView.textContent = 'Ver';
    btnView.addEventListener('click', async()=>{
      try{
        const rec = await getOne('summaryArchives', a.id);
        if (!rec){
          showToast('No se encontró el snapshot.', 'error', 3500);
          return;
        }
        __A33_SUMMARY_MODE = 'archive';
        __A33_ACTIVE_ARCHIVE = rec;
        try{ __A33_SUMMARY_VIEW_MODE = 'period'; }catch(_){ }
        closeSummaryArchiveModalPOS();
        setSummaryModeBadgePOS();
        syncSummaryPeriodLabelPOS();
        applySummaryArchiveGuardsPOS();
        await renderSummary();
      }catch(err){
        console.error('ver snapshot', err);
        alert('No se pudo abrir el snapshot: ' + humanizeError(err));
      }
    });

    const btnRe = document.createElement('button');
    btnRe.type = 'button';
    btnRe.className = 'btn-pill btn-pill-mini';
    btnRe.textContent = 'Re-exportar Excel';
    btnRe.addEventListener('click', async()=>{
      try{
        const rec = await getOne('summaryArchives', a.id);
        const use = rec || a;
        const snap = use.snapshot || {};
        const sheets = snap.sheets || [];
        const fname = use.fileName || (`${use.seqStr || pad3POS(use.seq || 0)}-${periodFilePartPOS(use.periodKey || '')}.xlsx`);
        writeWorkbookFromSheetsPOS(fname, sheets);
        showToast('Excel re-exportado.', 'ok', 2500);
      }catch(err){
        console.error('re-export', err);
        alert('No se pudo re-exportar el Excel: ' + humanizeError(err));
      }
    });

    actions.appendChild(btnView);
    actions.appendChild(btnRe);
    tdAct.appendChild(actions);

    tr.appendChild(tdSeq);
    tr.appendChild(tdPer);
    tr.appendChild(tdWhen);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  }
}

// -----------------------------
// Archivo (modal) · Caches livianos (Etapa 4)
// - Evitan lecturas pesadas de summaryArchives al abrir Archivo/Consolidado en iPad.
// - Se invalidan por:
//   - Cambio en summaryArchives (archRev)
//   - Cambio en ventas del período activo (salesRev[YYYY-MM])
//   - Cambio del período mensual activo (YYYY-MM) (cache por periodKey)
// -----------------------------
const A33_POS_CONSOL_CACHE_VER = 1;
const LS_A33_POS_CONSOL_ARCH_REV = 'a33_pos_consol_arch_rev_v1';
const LS_A33_POS_CONSOL_SALES_REV_MAP = 'a33_pos_consol_sales_rev_map_v1';
const LS_A33_POS_SUMMARY_ARCH_INDEX = 'a33_pos_summary_archives_index_v1';
const LS_A33_POS_CONSOL_ARCH_AGG = 'a33_pos_consol_arch_agg_v1';
const LS_A33_POS_CONSOL_LIVE_CACHE = 'a33_pos_consol_live_cache_v1';

function lsGetJsonPOS(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    return (obj == null) ? fallback : obj;
  }catch(_){
    return fallback;
  }
}

function lsSetJsonPOS(key, obj){
  try{ localStorage.setItem(key, JSON.stringify(obj)); }catch(_){ }
}

function lsRemovePOS(key){
  try{ localStorage.removeItem(key); }catch(_){ }
}

function getConsolArchRevPOS(){
  try{
    const raw = localStorage.getItem(LS_A33_POS_CONSOL_ARCH_REV);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }catch(_){
    return 0;
  }
}

function bumpConsolArchRevPOS(){
  const v = Date.now();
  try{ localStorage.setItem(LS_A33_POS_CONSOL_ARCH_REV, String(v)); }catch(_){ }
  // invalidar caches derivados
  lsRemovePOS(LS_A33_POS_SUMMARY_ARCH_INDEX);
  lsRemovePOS(LS_A33_POS_CONSOL_ARCH_AGG);
  return v;
}

function getSalesRevMapPOS(){
  const m = lsGetJsonPOS(LS_A33_POS_CONSOL_SALES_REV_MAP, {});
  return (m && typeof m === 'object') ? m : {};
}

function getConsolSalesRevPOS(periodKey){
  const pk = String(periodKey || '').trim();
  if (!pk) return 0;
  const m = getSalesRevMapPOS();
  const v = Number(m[pk]);
  return Number.isFinite(v) ? v : 0;
}

function bumpConsolSalesRevPOS(periodKey){
  const pk = String(periodKey || '').trim();
  if (!pk) return;
  const m = getSalesRevMapPOS();
  m[pk] = Date.now();

  // Prune simple: mantener solo los más recientes (evita crecer infinito)
  try{
    const entries = Object.entries(m).map(([k,val])=>({k, t: Number(val)||0}));
    entries.sort((a,b)=> (b.t||0) - (a.t||0));
    const keep = entries.slice(0, 18);
    const next = {};
    for (const it of keep) next[it.k] = it.t;
    lsSetJsonPOS(LS_A33_POS_CONSOL_SALES_REV_MAP, next);
  }catch(_){
    lsSetJsonPOS(LS_A33_POS_CONSOL_SALES_REV_MAP, m);
  }

  // live cache por período queda invalidado por rev
}

function getConsolLiveCacheMapPOS(){
  const m = lsGetJsonPOS(LS_A33_POS_CONSOL_LIVE_CACHE, {});
  return (m && typeof m === 'object') ? m : {};
}

function getConsolLiveCachePOS(periodKey){
  const pk = String(periodKey || '').trim();
  if (!pk) return null;
  const m = getConsolLiveCacheMapPOS();
  const c = m[pk];
  return (c && typeof c === 'object') ? c : null;
}

function setConsolLiveCachePOS(periodKey, cacheObj){
  const pk = String(periodKey || '').trim();
  if (!pk) return;
  const m = getConsolLiveCacheMapPOS();
  m[pk] = cacheObj;
  // Prune simple: mantener últimos 12
  try{
    const entries = Object.entries(m).map(([k,val])=>({k, t: Number(val && val.computedAt)||0}));
    entries.sort((a,b)=> (b.t||0) - (a.t||0));
    const keep = entries.slice(0, 12);
    const next = {};
    for (const it of keep) next[it.k] = m[it.k];
    lsSetJsonPOS(LS_A33_POS_CONSOL_LIVE_CACHE, next);
  }catch(_){
    lsSetJsonPOS(LS_A33_POS_CONSOL_LIVE_CACHE, m);
  }
}

function clearConsolLiveCachePOS(periodKey){
  const pk = String(periodKey || '').trim();
  if (!pk) return;
  const m = getConsolLiveCacheMapPOS();
  if (m && Object.prototype.hasOwnProperty.call(m, pk)){
    try{ delete m[pk]; }catch(_){ }
    lsSetJsonPOS(LS_A33_POS_CONSOL_LIVE_CACHE, m);
  }
}

function extractArchiveIndexItemPOS(a){
  if (!a) return null;
  const periodKey = String(a.periodKey || '').trim();
  return {
    id: a.id,
    seq: Number(a.seq || 0) || 0,
    seqStr: String(a.seqStr || pad3POS(a.seq || 0)),
    periodKey,
    periodLabel: String(a.periodLabel || periodLabelPOS(periodKey)),
    createdAt: a.createdAt || a.exportedAt || '',
    exportedAt: a.exportedAt || '',
    name: a.name || '',
    fileName: a.fileName || ''
  };
}

async function rebuildSummaryArchivesCachesPOS(){
  const all = await getAll('summaryArchives');
  const list = Array.isArray(all) ? all : [];

  const items = [];
  const periodIndex = {}; // periodKey -> { id, seq, seqStr, createdAt, periodLabel }

  const acc = { grand:0, discountTotal:0, grandCost:0, grandProfit:0, courtesyCost:0, profitAfterCourtesy:0, courtesyQty:0, courtesyTx:0, courtesyEquiv:0 };

  for (const a of list){
    if (!a) continue;

    // Index liviano (para tabla)
    const it = extractArchiveIndexItemPOS(a);
    if (it){
      items.push(it);
      if (it.periodKey){
        periodIndex[it.periodKey] = {
          id: it.id,
          seq: it.seq,
          seqStr: it.seqStr,
          createdAt: it.createdAt,
          periodLabel: it.periodLabel
        };
      }
    }

    // Métricas archivadas (para Consolidado)
    const snap = (a.snapshot && typeof a.snapshot === 'object') ? a.snapshot : {};
    const sheets = Array.isArray(snap.sheets) ? snap.sheets : [];
    let m = (snap.metrics && typeof snap.metrics === 'object') ? snap.metrics : null;
    if (!m){
      try{ m = parseArchiveMetricsFromSummarySheetPOS(sheets); }catch(_){ m = null; }
    }
    const nm = normalizeArchiveMetricsPOS(m || {});
    acc.grand += nm.grand;
    acc.discountTotal += nm.discountTotal;
    acc.grandCost += nm.grandCost;
    acc.grandProfit += nm.grandProfit;
    acc.courtesyCost += nm.courtesyCost;
    acc.profitAfterCourtesy += nm.profitAfterCourtesy;
    acc.courtesyQty += nm.courtesyQty;
    acc.courtesyTx += nm.courtesyTx;
    acc.courtesyEquiv += nm.courtesyEquiv;
  }

  // Orden descendente por fecha
  items.sort((a,b)=>{
    const aa = Number(a && (a.createdAt || a.exportedAt) || 0);
    const bb = Number(b && (b.createdAt || b.exportedAt) || 0);
    return bb - aa;
  });

  const archRev = getConsolArchRevPOS();
  const computedAt = Date.now();
  const indexCache = { v: A33_POS_CONSOL_CACHE_VER, archRev, computedAt, items };
  const archAggCache = {
    v: A33_POS_CONSOL_CACHE_VER,
    archRev,
    computedAt,
    count: items.length,
    metrics: acc,
    periodKeys: Object.keys(periodIndex),
    periodIndex
  };
  lsSetJsonPOS(LS_A33_POS_SUMMARY_ARCH_INDEX, indexCache);
  lsSetJsonPOS(LS_A33_POS_CONSOL_ARCH_AGG, archAggCache);

  return { indexCache, archAggCache };
}

async function getSummaryArchivesIndexPOS(opts){
  const force = !!(opts && opts.force);
  const archRev = getConsolArchRevPOS();
  const cached = lsGetJsonPOS(LS_A33_POS_SUMMARY_ARCH_INDEX, null);
  if (!force && cached && cached.v === A33_POS_CONSOL_CACHE_VER && Number(cached.archRev) === archRev && Array.isArray(cached.items)){
    return cached.items;
  }
  const rebuilt = await rebuildSummaryArchivesCachesPOS();
  return (rebuilt && rebuilt.indexCache && Array.isArray(rebuilt.indexCache.items)) ? rebuilt.indexCache.items : [];
}

async function getConsolidatedArchivedAggPOS(opts){
  const force = !!(opts && opts.force);
  const archRev = getConsolArchRevPOS();
  const cached = lsGetJsonPOS(LS_A33_POS_CONSOL_ARCH_AGG, null);
  if (!force && cached && cached.v === A33_POS_CONSOL_CACHE_VER && Number(cached.archRev) === archRev && cached.metrics){
    return cached;
  }
  const rebuilt = await rebuildSummaryArchivesCachesPOS();
  return (rebuilt && rebuilt.archAggCache) ? rebuilt.archAggCache : { count:0, metrics: zeroArchiveMetricsPOS(), periodKeys:[], periodIndex:{} };
}

async function loadAndRenderArchivesPOS(opts){
  const force = !!(opts && opts.force);
  const list = await getSummaryArchivesIndexPOS({ force });

  const q = (document.getElementById('summary-archive-search')?.value || '').toString().trim().toLowerCase();
  const filtered = q
    ? list.filter(a => {
        const s = `${a.seqStr||''} ${a.periodLabel||''} ${a.periodKey||''} ${a.name||''}`.toLowerCase();
        return s.includes(q);
      })
    : list;

  renderSummaryArchivesTablePOS(filtered);
}

// -----------------------------
// Archivo (modal) · Vista CONSOLIDADO (solo UI en Etapa 1)
// -----------------------------
let __A33_SUMMARY_ARCHIVE_PANEL_MODE = 'list'; // 'list' | 'consolidated'

function isSummaryConsolidatedViewActivePOS(){
  return (__A33_SUMMARY_ARCHIVE_PANEL_MODE === 'consolidated');
}

function applySummaryConsolidatedGuardsPOS(){
  const active = isSummaryConsolidatedViewActivePOS();
  // Bloqueos duros: acciones peligrosas (cierre/archivo/export oficial)
  const ids = ['btn-summary-close-day','btn-summary-reopen-day','btn-summary-close-period','btn-summary-export','summary-close-export','summary-close-confirm'];
  for (const id of ids){
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.dataset && el.dataset.prevDisabledConsolidated == null) el.dataset.prevDisabledConsolidated = el.disabled ? '1' : '0';
    if (active){
      try{ el.disabled = true; }catch(_){ }
    } else {
      try{ el.disabled = (el.dataset && el.dataset.prevDisabledConsolidated === '1'); }catch(_){ }
    }
  }
}

function setSummaryArchivePanelModePOS(mode){
  __A33_SUMMARY_ARCHIVE_PANEL_MODE = (mode === 'consolidated') ? 'consolidated' : 'list';

  const listView = document.getElementById('summary-archive-view-list');
  const consView = document.getElementById('summary-archive-view-consolidated');
  if (listView) listView.style.display = (__A33_SUMMARY_ARCHIVE_PANEL_MODE === 'list') ? '' : 'none';
  if (consView) consView.style.display = (__A33_SUMMARY_ARCHIVE_PANEL_MODE === 'consolidated') ? '' : 'none';

  const search = document.getElementById('summary-archive-search');
  const btnRefresh = document.getElementById('summary-archive-refresh');
  const btnCon = document.getElementById('summary-archive-consolidated');

  // En consolidado ocultamos controles de archivo (no aplican)
  const showListControls = (__A33_SUMMARY_ARCHIVE_PANEL_MODE === 'list');
  if (search) search.style.display = showListControls ? '' : 'none';
  if (btnRefresh) btnRefresh.style.display = showListControls ? '' : 'none';
  if (btnCon) btnCon.style.display = showListControls ? '' : 'none';

  applySummaryConsolidatedGuardsPOS();

  // Al entrar a CONSOLIDADO recalcular ARCHIVADO (Etapa 2)
  if (__A33_SUMMARY_ARCHIVE_PANEL_MODE === 'consolidated'){
    renderSummaryArchiveConsolidatedPOS().catch(err=>{
      console.error('render consolidated', err);
    });
  }
}

function __numPOS(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseArchiveMetricsFromSummarySheetPOS(sheets){
  const rows = readSheetRowsPOS(sheets, 'Resumen');
  const out = {};
  for (const r of (rows || [])){
    if (!r || r.length < 2) continue;
    const label = String(r[0] || '').trim();
    if (!label) continue;
    const val = __numPOS(r[1]);
    switch (label){
      case 'Total general': out.grand = val; break;
      case 'Total descuento': out.discountTotal = val; break;
      case 'Costo estimado': out.grandCost = val; break;
      case 'Utilidad bruta': out.grandProfit = val; break;
      case 'Cortesías (Costo real)': out.courtesyCost = val; break;
      case 'Utilidad después de cortesías': out.profitAfterCourtesy = val; break;
      case 'Cortesías (unidades)': out.courtesyQty = val; break;
      case 'Cortesías (movimientos)': out.courtesyTx = val; break;
      case 'Cortesías (equivalente ventas)': out.courtesyEquiv = val; break;
      default: break;
    }
  }
  return out;
}

function normalizeArchiveMetricsPOS(m){
  const grand = __numPOS(m && m.grand);
  const discountTotal = __numPOS(m && m.discountTotal);
  const grandCost = __numPOS(m && m.grandCost);
  const grandProfit = __numPOS(m && m.grandProfit);
  const courtesyCost = __numPOS(m && m.courtesyCost);
  const courtesyQty = __numPOS(m && m.courtesyQty);
  const courtesyTx = __numPOS(m && m.courtesyTx);
  const courtesyEquiv = __numPOS(m && m.courtesyEquiv);
  const profitAfterCourtesy = (m && m.profitAfterCourtesy != null) ? __numPOS(m.profitAfterCourtesy) : (grandProfit - courtesyCost);
  return { grand, discountTotal, grandCost, grandProfit, courtesyCost, profitAfterCourtesy, courtesyQty, courtesyTx, courtesyEquiv };
}

function zeroArchiveMetricsPOS(){
  return { grand:0, discountTotal:0, grandCost:0, grandProfit:0, courtesyCost:0, profitAfterCourtesy:0, courtesyQty:0, courtesyTx:0, courtesyEquiv:0 };
}

function sumArchiveMetricsPOS(a, b){
  const x = normalizeArchiveMetricsPOS(a || {});
  const y = normalizeArchiveMetricsPOS(b || {});
  return {
    grand: x.grand + y.grand,
    discountTotal: x.discountTotal + y.discountTotal,
    grandCost: x.grandCost + y.grandCost,
    grandProfit: x.grandProfit + y.grandProfit,
    courtesyCost: x.courtesyCost + y.courtesyCost,
    profitAfterCourtesy: x.profitAfterCourtesy + y.profitAfterCourtesy,
    courtesyQty: x.courtesyQty + y.courtesyQty,
    courtesyTx: x.courtesyTx + y.courtesyTx,
    courtesyEquiv: x.courtesyEquiv + y.courtesyEquiv,
  };
}

function writeConsolidatedMetricsToCardPOS(prefix, m){
  const id = (s)=> document.getElementById(`${prefix}-${s}`);
  const nm = normalizeArchiveMetricsPOS(m || {});
  const elGrand = id('grand');
  if (elGrand) elGrand.textContent = fmt(__numPOS(nm.grand));
  const elCost = id('grandCost');
  if (elCost) elCost.textContent = fmt(__numPOS(nm.grandCost));
  const elProfit = id('grandProfit');
  if (elProfit) elProfit.textContent = fmt(__numPOS(nm.grandProfit));
  const elCourCost = id('courtesyCost');
  if (elCourCost) elCourCost.textContent = fmt(__numPOS(nm.courtesyCost));
  const elPA = id('profitAfterCourtesy');
  if (elPA) elPA.textContent = fmt(__numPOS(nm.profitAfterCourtesy));
  const elCQ = id('courtesyQty');
  if (elCQ) elCQ.textContent = String(Math.round(__numPOS(nm.courtesyQty)));
  const elCT = id('courtesyTx');
  if (elCT) elCT.textContent = String(Math.round(__numPOS(nm.courtesyTx)));
  const elCE = id('courtesyEquiv');
  if (elCE) elCE.textContent = fmt(__numPOS(nm.courtesyEquiv));
}

// Render token para evitar updates tardíos si el usuario sale rápido
let __A33_CONSOLIDATED_RENDER_TOKEN = 0;

function fmtConsolidatedUpdatedPOS(ts){
  const t = Number(ts) || 0;
  if (!t) return '…';
  try{ return fmtDateTimePOS(t); }catch(_){
    try{ return new Date(t).toLocaleString(); }catch(__){ return String(t); }
  }
}

async function computeArchivedConsolidatedMetricsPOS(opts){
  const force = !!(opts && opts.force);
  const res = await getConsolidatedArchivedAggPOS({ force });
  return {
    count: Number(res && res.count) || 0,
    metrics: normalizeArchiveMetricsPOS((res && res.metrics) ? res.metrics : {}),
    periodIndex: (res && res.periodIndex && typeof res.periodIndex === 'object') ? res.periodIndex : {},
    computedAt: Number(res && res.computedAt) || 0,
  };
}



// -----------------------------
// CONSOLIDADO · Exportar Excel (Gerente) — Etapa 1
// -----------------------------
function fmtArchiveAtCellPOS(v){
  if (v == null) return '';
  const n = Number(v);
  if (Number.isFinite(n) && n > 0){
    try{ return fmtDateTimePOS(n); }catch(_){
      try{ return new Date(n).toLocaleString(); }catch(__){ return String(n); }
    }
  }
  const s = String(v || '').trim();
  if (!s) return '';
  // ISO u otro
  try{
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toLocaleString();
  }catch(_){ }
  return s;
}

async function getArchivedAggAndIndexPOS(opts){
  const force = !!(opts && opts.force);
  const requireFresh = !!(opts && opts.requireFresh);
  const archRevExpected = (opts && Object.prototype.hasOwnProperty.call(opts, 'archRevExpected')) ? Number(opts.archRevExpected) : null;
  const archRev = (Number.isFinite(archRevExpected) && archRevExpected != null) ? archRevExpected : getConsolArchRevPOS();
  const cachedAgg = lsGetJsonPOS(LS_A33_POS_CONSOL_ARCH_AGG, null);
  const cachedIdx = lsGetJsonPOS(LS_A33_POS_SUMMARY_ARCH_INDEX, null);

  const okAgg = (!force && cachedAgg && cachedAgg.v === A33_POS_CONSOL_CACHE_VER && Number(cachedAgg.archRev) === archRev && cachedAgg.metrics);
  const okIdx = (!force && cachedIdx && cachedIdx.v === A33_POS_CONSOL_CACHE_VER && Number(cachedIdx.archRev) === archRev && Array.isArray(cachedIdx.items));

  if (okAgg && okIdx){
    return { archAgg: cachedAgg, indexItems: cachedIdx.items };
  }

  try{
    const rebuilt = await rebuildSummaryArchivesCachesPOS();
    return {
      archAgg: (rebuilt && rebuilt.archAggCache) ? rebuilt.archAggCache : { count:0, metrics: zeroArchiveMetricsPOS(), periodIndex:{}, computedAt:0 },
      indexItems: (rebuilt && rebuilt.indexCache && Array.isArray(rebuilt.indexCache.items)) ? rebuilt.indexCache.items : []
    };
  }catch(err){
    console.error('rebuildSummaryArchivesCachesPOS', err);
    // En export gerencial, NO es aceptable caer en números viejos por accidente.
    // Si se pide frescura, abortar y pedir reintento.
    if (requireFresh){
      throw err;
    }
    // Fallback: lo que haya en cache (aunque sea viejo)
    return {
      archAgg: cachedAgg || { count:0, metrics: zeroArchiveMetricsPOS(), periodIndex:{}, computedAt:0 },
      indexItems: (cachedIdx && Array.isArray(cachedIdx.items)) ? cachedIdx.items : []
    };
  }
}

function buildConsolidatedGerenteSheetsPOS(payload){
  const p = payload || {};
  const periodKey = String(p.periodKey || '');
  const periodLabel = String(p.periodLabel || '');
  const updatedAt = Number(p.updatedAt) || 0;

  const arch = normalizeArchiveMetricsPOS(p.archMetrics || {});
  const live = normalizeArchiveMetricsPOS(p.liveMetrics || {});
  const total = normalizeArchiveMetricsPOS(p.totalMetrics || {});

  const archivesCount = (p && Object.prototype.hasOwnProperty.call(p, 'archivesCount')) ? (Number(p.archivesCount) || 0) : (Array.isArray(p.archivesIndex) ? p.archivesIndex.length : 0);
  const liveIncluded = (p && p.liveIncluded === false) ? false : true;
  const liveExcludedSeqStr = String((p && p.liveExcludedSeqStr) ? p.liveExcludedSeqStr : '').trim();
  const activePeriodKey = String((p && p.activePeriodKey) ? p.activePeriodKey : (periodKey || ''));
  const activeArchiveId = (p && Object.prototype.hasOwnProperty.call(p, 'activeArchiveId')) ? p.activeArchiveId : null;

  const r = [];
  r.push(['CONSOLIDADO (GERENTE)']);
  r.push([]);
  r.push(['Período activo (YYYY-MM)', periodKey]);
  r.push(['Etiqueta del período', periodLabel]);
  r.push(['Actualizado', fmtConsolidatedUpdatedPOS(updatedAt)]);
  r.push([]);

  // Trazabilidad (Etapa 2)
  r.push(['Trazabilidad']);
  r.push([`Períodos archivados incluidos: ${archivesCount}`]);
  r.push([`VIVO incluido en TOTAL: ${liveIncluded ? 'SÍ' : 'NO'}`]);
  if (!liveIncluded){
    const reason = liveExcludedSeqStr ? `Motivo: Período actual ya archivado (Seq ${liveExcludedSeqStr})` : 'Motivo: Período actual ya archivado (anti doble conteo)';
    r.push([reason]);
  }
  r.push([]);

  const addBlock = (title, m)=>{
    r.push([title]);
    r.push(['Métrica','Monto C$']);
    r.push(['Total general', __numPOS(m.grand)]);
    r.push(['Costo estimado', __numPOS(m.grandCost)]);
    r.push(['Utilidad bruta', __numPOS(m.grandProfit)]);
    r.push(['Cortesías (Costo real)', __numPOS(m.courtesyCost)]);
    r.push(['Utilidad después de cortesías', __numPOS(m.profitAfterCourtesy)]);
  };

  addBlock('ARCHIVADO', arch);
  r.push([]);
  addBlock('VIVO', live);
  r.push([]);
  addBlock('TOTAL CONSOLIDADO', total);

  const aRows = [['Seq','Período (label)','PeriodKey','Fecha de archivo','Nombre','Archivo .xlsx','Es período activo','Nota']];
  const list = Array.isArray(p.archivesIndex) ? p.archivesIndex : [];
  for (const it of list){
    if (!it) continue;
    const itPeriodKey = String(it.periodKey || '');
    const isActive = !!(activePeriodKey && itPeriodKey && itPeriodKey === activePeriodKey);
    const isActiveExact = !!(activeArchiveId != null && it.id != null && it.id === activeArchiveId);
    const markForNote = isActiveExact || (isActive && activeArchiveId == null);
    aRows.push([
      (String(it.seqStr || '').trim() || ((Number(it.seq || 0) || 0) ? pad3POS(it.seq) : '')),
      (it.periodLabel || ''),
      itPeriodKey,
      fmtArchiveAtCellPOS(it.createdAt || it.exportedAt || ''),
      (it.name || ''),
      (it.fileName || ''),
      (isActive ? 'SÍ' : 'NO'),
      (!liveIncluded && markForNote ? 'Período activo ya archivado (anti doble conteo)' : '')
    ]);
  }

  return [
    { name: 'RESUMEN', rows: r },
    { name: 'ARCHIVADOS_INCLUIDOS', rows: aRows }
  ];
}

async function exportConsolidatedGerenteExcelPOS(){
  // Guard para doble-click
  if (window.__A33_CONSOL_EXPORT_GERENTE_BUSY) return;

  const btn = document.getElementById('summary-consolidated-export-gerente');

  const setBusy = (busy)=>{
    try{
      if (!btn) return;
      btn.disabled = !!busy;
      btn.setAttribute('aria-busy', busy ? 'true' : 'false');
      if (busy){
        if (!btn.dataset.prevTextGerente) btn.dataset.prevTextGerente = btn.textContent || '';
        btn.textContent = 'Generando…';
      } else {
        const prev = btn.dataset.prevTextGerente;
        if (prev != null) btn.textContent = prev;
        try{ delete btn.dataset.prevTextGerente; }catch(_){ }
      }
    }catch(_){ }
  };

  // XLSX puede faltar si el módulo se abrió por primera vez sin conexión.
  if (typeof XLSX === 'undefined'){
    showToast('No se pudo generar el Excel (XLSX no cargado). Si es tu primera carga offline: abrí el POS una vez con internet para cachear y reintentá.', 'error', 7000);
    return;
  }

  window.__A33_CONSOL_EXPORT_GERENTE_BUSY = true;
  setBusy(true);

  try{
    showToast('Generando Excel…', 'ok', 15000);
    // Dejar pintar UI antes de empezar
    await new Promise(r=>setTimeout(r,0));

    // Snapshot de revisiones (evita “números viejos” si algo cambia mientras exporta)
    const periodKey0 = getSummarySelectedPeriodKeyPOS();
    const periodLabel = periodLabelPOS(periodKey0);
    const salesRev0 = getConsolSalesRevPOS(periodKey0);
    const archRev0 = getConsolArchRevPOS();

    // ARCHIVADO: caches livianos, pero SOLO si son frescos. Si no, abortar.
    const { archAgg, indexItems } = await getArchivedAggAndIndexPOS({ force: false, requireFresh: true, archRevExpected: archRev0 });
    if (Number(archAgg && archAgg.archRev) !== Number(archRev0)){
      throw a33ValidationErrorPOS('El Archivo cambió mientras se preparaba el Excel. Reintentá para números actuales.');
    }
    const archMetrics = normalizeArchiveMetricsPOS((archAgg && archAgg.metrics) ? archAgg.metrics : {});
    const periodIndex = (archAgg && archAgg.periodIndex && typeof archAgg.periodIndex === 'object') ? archAgg.periodIndex : {};
    const alreadyInfo = (periodIndex && periodKey0) ? (periodIndex[periodKey0] || null) : null;
    const alreadyArchived = !!alreadyInfo;

    // Trazabilidad: Seq del período activo si ya está archivado
    let alreadySeqStr = '';
    let alreadyArchiveId = null;
    if (alreadyInfo){
      alreadyArchiveId = (Object.prototype.hasOwnProperty.call(alreadyInfo, 'id')) ? alreadyInfo.id : null;
      const ss = String(alreadyInfo.seqStr || '').trim();
      if (ss) alreadySeqStr = ss;
      else {
        const n = Number(alreadyInfo.seq || 0) || 0;
        alreadySeqStr = n ? pad3POS(n) : '';
      }
    }

    // VIVO: cache liviano por salesRev (o calcular 1 vez y actualizar cache)
    let liveMetrics = zeroArchiveMetricsPOS();
    let liveComputedAt = 0;
    if (!alreadyArchived){
      const liveCache = getConsolLiveCachePOS(periodKey0);
      if (liveCache && liveCache.v === A33_POS_CONSOL_CACHE_VER && Number(liveCache.salesRev) === salesRev0 && liveCache.metrics){
        liveMetrics = normalizeArchiveMetricsPOS(liveCache.metrics);
        liveComputedAt = Number(liveCache.computedAt) || 0;
      } else {
        const data = await computeSummaryDataForPeriodPOS(periodKey0, SUMMARY_EVENT_GLOBAL_POS);
        liveMetrics = normalizeArchiveMetricsPOS((data && data.metrics) ? data.metrics : {});
        liveComputedAt = Date.now();
        // Nota: solo localStorage (no IndexedDB / meta). Es cache liviano.
        setConsolLiveCachePOS(periodKey0, {
          v: A33_POS_CONSOL_CACHE_VER,
          periodKey: periodKey0,
          archRev: archRev0,
          salesRev: salesRev0,
          computedAt: liveComputedAt,
          metrics: liveMetrics,
        });
      }
    }

    const totalMetrics = alreadyArchived ? archMetrics : sumArchiveMetricsPOS(archMetrics, liveMetrics);
    const updatedAt = Math.max(Number(archAgg && archAgg.computedAt) || 0, liveComputedAt || 0);

    // Revalidar snapshot antes de escribir archivo
    const periodKey1 = getSummarySelectedPeriodKeyPOS();
    const salesRev1 = getConsolSalesRevPOS(periodKey1);
    const archRev1 = getConsolArchRevPOS();
    if (periodKey1 !== periodKey0 || Number(salesRev1) !== Number(salesRev0) || Number(archRev1) !== Number(archRev0)){
      throw a33ValidationErrorPOS('Hubo cambios (ventas/archivo/período) mientras se generaba el Excel. Reintentá para números actuales.');
    }

    const sheets = buildConsolidatedGerenteSheetsPOS({
      periodKey: periodKey0,
      periodLabel,
      updatedAt,
      archMetrics,
      liveMetrics,
      totalMetrics,
      archivesIndex: indexItems,
      archivesCount: Array.isArray(indexItems) ? indexItems.length : (Number(archAgg && archAgg.count) || 0),
      liveIncluded: !alreadyArchived,
      liveExcludedSeqStr: alreadySeqStr,
      activePeriodKey: periodKey0,
      activeArchiveId: alreadyArchiveId
    });

    const fname = `Consolidado-Gerente-${periodFilePartPOS(periodKey0)}.xlsx`;
    writeWorkbookFromSheetsPOS(fname, sheets);
    showToast('Excel generado ✅', 'ok', 2500);
  }catch(err){
    console.error('exportConsolidatedGerenteExcelPOS', err);
    const detail = humanizeError(err);
    // Mensaje corto pero claro (sin dejar botón muerto)
    showToast(`No se pudo generar el Excel. ${detail}`, 'error', 8000);
  }finally{
    setBusy(false);
    window.__A33_CONSOL_EXPORT_GERENTE_BUSY = false;
  }
}

async function renderSummaryArchiveConsolidatedPOS(){
  if (!isSummaryConsolidatedViewActivePOS()) return;
  const token = ++__A33_CONSOLIDATED_RENDER_TOKEN;

  const id = (s)=> document.getElementById(s);
  const countEl = id('summary-consolidated-arch-count');
  const updatedEl = id('summary-consolidated-updated');
  const livePeriodEl = id('summary-consolidated-live-period');
  const liveNoteEl = id('summary-consolidated-live-note');

  if (!countEl) return;

  const periodKey = getSummarySelectedPeriodKeyPOS();
  const salesRev = getConsolSalesRevPOS(periodKey);
  const archRev = getConsolArchRevPOS();

  // Render inmediato (cache localStorage si está)
  if (livePeriodEl) livePeriodEl.textContent = `Período: ${periodLabelPOS(periodKey)} (${periodKey})`;

  let archCached = lsGetJsonPOS(LS_A33_POS_CONSOL_ARCH_AGG, null);
  let hasArchCache = !!(archCached && archCached.v === A33_POS_CONSOL_CACHE_VER && Number(archCached.archRev) === archRev && archCached.metrics);

  if (hasArchCache){
    const n = Number(archCached.count) || 0;
    countEl.textContent = `Períodos archivados incluidos: ${n}`;
    const archMetrics0 = normalizeArchiveMetricsPOS(archCached.metrics);
    writeConsolidatedMetricsToCardPOS('summary-consolidated-arch', archMetrics0);
  } else {
    countEl.textContent = 'Períodos archivados incluidos: …';
  }

  let periodIndex0 = (hasArchCache && archCached.periodIndex && typeof archCached.periodIndex === 'object') ? archCached.periodIndex : {};
  let alreadyInfo0 = periodIndex0 ? periodIndex0[periodKey] : null;
  let alreadyArchived0 = !!alreadyInfo0;

  if (liveNoteEl){
    if (alreadyArchived0){
      const tag = (alreadyInfo0 && alreadyInfo0.seqStr) ? ` (Seq ${alreadyInfo0.seqStr})` : '';
      liveNoteEl.textContent = `Este período ya está archivado${tag}: VIVO queda en 0 para evitar doble conteo.`;
      liveNoteEl.style.display = '';
    } else {
      liveNoteEl.style.display = 'none';
    }
  }

  let liveMetrics0 = zeroArchiveMetricsPOS();
  let liveCache0 = null;
  let usedLiveCache0 = false;
  if (!alreadyArchived0){
    liveCache0 = getConsolLiveCachePOS(periodKey);
    if (liveCache0 && liveCache0.v === A33_POS_CONSOL_CACHE_VER && Number(liveCache0.salesRev) === salesRev && liveCache0.metrics){
      liveMetrics0 = normalizeArchiveMetricsPOS(liveCache0.metrics);
      usedLiveCache0 = true;
    }
  }
  writeConsolidatedMetricsToCardPOS('summary-consolidated-live', liveMetrics0);

  // Total (si ya hay archivado en cache)
  if (hasArchCache){
    const archMetrics0 = normalizeArchiveMetricsPOS(archCached.metrics);
    const total0 = alreadyArchived0 ? archMetrics0 : sumArchiveMetricsPOS(archMetrics0, liveMetrics0);
    writeConsolidatedMetricsToCardPOS('summary-consolidated-total', total0);
  } else {
    writeConsolidatedMetricsToCardPOS('summary-consolidated-total', zeroArchiveMetricsPOS());
  }

  // Updated microtexto
  if (updatedEl){
    const tArch = hasArchCache ? (Number(archCached.computedAt)||0) : 0;
    const tLive = usedLiveCache0 && liveCache0 ? (Number(liveCache0.computedAt)||0) : 0;
    const t = Math.max(tArch, tLive);
    updatedEl.textContent = `Actualizado: ${fmtConsolidatedUpdatedPOS(t)}`;
  }

  // Dejar pintar UI antes de cálculos pesados
  await new Promise(r=>setTimeout(r,0));
  if (!isSummaryConsolidatedViewActivePOS() || token !== __A33_CONSOLIDATED_RENDER_TOKEN) return;

  // 1) ARCHIVADO (rebuild si hace falta)
  let archRes = null;
  try{
    archRes = await computeArchivedConsolidatedMetricsPOS({ force: false });
  }catch(err){
    console.error('compute archived consolidated', err);
    archRes = { count:0, metrics: zeroArchiveMetricsPOS(), periodIndex: {}, computedAt: 0 };
  }

  if (!isSummaryConsolidatedViewActivePOS() || token !== __A33_CONSOLIDATED_RENDER_TOKEN) return;

  const archMetrics = normalizeArchiveMetricsPOS(archRes.metrics);
  countEl.textContent = `Períodos archivados incluidos: ${Number(archRes.count)||0}`;
  writeConsolidatedMetricsToCardPOS('summary-consolidated-arch', archMetrics);

  const periodIndex = (archRes && archRes.periodIndex) ? archRes.periodIndex : {};
  const alreadyInfo = periodIndex ? periodIndex[periodKey] : null;
  const alreadyArchived = !!alreadyInfo;

  if (liveNoteEl){
    if (alreadyArchived){
      const tag = (alreadyInfo && alreadyInfo.seqStr) ? ` (Seq ${alreadyInfo.seqStr})` : '';
      liveNoteEl.textContent = `Este período ya está archivado${tag}: VIVO queda en 0 para evitar doble conteo.`;
      liveNoteEl.style.display = '';
    } else {
      liveNoteEl.style.display = 'none';
    }
  }

  // 2) VIVO (solo si no está ya archivado)
  let liveMetrics = zeroArchiveMetricsPOS();
  let liveComputedAt = 0;
  if (!alreadyArchived){
    // re-check cache (por si se llenó mientras tanto)
    const liveCache = getConsolLiveCachePOS(periodKey);
    if (liveCache && liveCache.v === A33_POS_CONSOL_CACHE_VER && Number(liveCache.salesRev) === salesRev && liveCache.metrics){
      liveMetrics = normalizeArchiveMetricsPOS(liveCache.metrics);
      liveComputedAt = Number(liveCache.computedAt)||0;
    } else {
      try{
        const data = await computeSummaryDataForPeriodPOS(periodKey, SUMMARY_EVENT_GLOBAL_POS);
        liveMetrics = normalizeArchiveMetricsPOS((data && data.metrics) ? data.metrics : {});
      }catch(err){
        console.error('compute live consolidated', err);
        liveMetrics = zeroArchiveMetricsPOS();
      }
      liveComputedAt = Date.now();
      setConsolLiveCachePOS(periodKey, {
        v: A33_POS_CONSOL_CACHE_VER,
        periodKey,
        archRev, // por depuración/observabilidad
        salesRev,
        computedAt: liveComputedAt,
        metrics: liveMetrics,
      });
    }
  }

  if (!isSummaryConsolidatedViewActivePOS() || token !== __A33_CONSOLIDATED_RENDER_TOKEN) return;
  writeConsolidatedMetricsToCardPOS('summary-consolidated-live', liveMetrics);

  // 3) TOTAL (anti doble conteo)
  const totalMetrics = alreadyArchived ? archMetrics : sumArchiveMetricsPOS(archMetrics, liveMetrics);
  writeConsolidatedMetricsToCardPOS('summary-consolidated-total', totalMetrics);

  // Updated microtexto final
  if (updatedEl){
    const t = Math.max(Number(archRes.computedAt)||0, liveComputedAt||0);
    updatedEl.textContent = `Actualizado: ${fmtConsolidatedUpdatedPOS(t)}`;
  }
}

async function openSummaryArchiveModalPOS(){
  setSummaryArchivePanelModePOS('list');
  await loadAndRenderArchivesPOS();
  openModalPOS('summary-archive-modal');
}

function closeSummaryArchiveModalPOS(){
  // Siempre restaurar a lista (y remover candados de Consolidado)
  setSummaryArchivePanelModePOS('list');
  closeModalPOS('summary-archive-modal');
}

// Entrar/salir del modo Archivo en Resumen (snapshot)
async function enterSummaryArchiveModePOS(archiveId){
  const rec = await getOne('summaryArchives', archiveId);
  if (!rec){
    showToast('No se encontró el snapshot.', 'error', 3500);
    return;
  }
  __A33_SUMMARY_MODE = 'archive';
  __A33_ACTIVE_ARCHIVE = rec;
  try{ __A33_SUMMARY_VIEW_MODE = 'period'; }catch(_){ }
  setSummaryModeBadgePOS();
  syncSummaryPeriodLabelPOS();
  applySummaryArchiveGuardsPOS();
  await renderSummary();
}

function exitSummaryArchiveModePOS(){
  __A33_SUMMARY_MODE = 'live';
  __A33_ACTIVE_ARCHIVE = null;
  setSummaryModeBadgePOS();
  syncSummaryPeriodLabelPOS();
  applySummaryArchiveGuardsPOS();
  renderSummary();
}

async function onSummaryExportExcelPOS(){
  if (isSummaryConsolidatedViewActivePOS()){
    showToast('CONSOLIDADO es solo lectura. Volvé a Archivo normal para exportar/cerrar.', 'error', 4000);
    return;
  }

  // En Archivo: exportar exactamente lo archivado
  if (__A33_SUMMARY_MODE === 'archive' && __A33_ACTIVE_ARCHIVE){
    const a = __A33_ACTIVE_ARCHIVE;
    const snap = a.snapshot || {};
    const sheets = snap.sheets || [];
    const pk = a.periodKey || snap.periodKey || '';
    const fname = a.fileName || (`${a.seqStr || pad3POS(a.seq || 0)}-${periodFilePartPOS(pk)}.xlsx`);
    writeWorkbookFromSheetsPOS(fname, sheets);
    showToast('Excel exportado (archivo).', 'ok', 2500);
    return;
  }

  // En vivo
  if (__A33_SUMMARY_VIEW_MODE === 'all'){
    showToast('Selecciona un período para exportar.', 'error', 3500);
    return;
  }
  const periodKey = getSummarySelectedPeriodKeyPOS();
  let selectedSummaryEventId = SUMMARY_EVENT_GLOBAL_POS;
  try{ selectedSummaryEventId = await getSelectedSummaryEventIdPOS(); }catch(_){ selectedSummaryEventId = SUMMARY_EVENT_GLOBAL_POS; }
  const data = await computeSummaryDataForPeriodPOS(periodKey, selectedSummaryEventId);
  const sheets = buildSummarySheetsFromDataPOS(data);
  const fname = `Resumen-${periodFilePartPOS(periodKey)}.xlsx`;
  writeWorkbookFromSheetsPOS(fname, sheets);
  showToast('Excel exportado.', 'ok', 2500);
}

function bindSummaryPeriodCloseAndArchivePOS(){
  // Período selector
  const periodEl = document.getElementById('summary-period');
  if (periodEl){
    if (!String(periodEl.value||'').trim()){
      try{ periodEl.value = getSummarySelectedPeriodKeyPOS(); }catch(_){ }
    }
    periodEl.addEventListener('change', ()=>{
      if (__A33_SUMMARY_MODE === 'archive') return;
      __A33_SUMMARY_VIEW_MODE = 'period';
      setSummaryModeBadgePOS();
      syncSummaryPeriodLabelPOS();
      renderSummary();
    });
  }

  // Todo / volver a vivo
  const btnAll = document.getElementById('btn-summary-all');
  if (btnAll){
    btnAll.addEventListener('click', ()=>{
      if (__A33_SUMMARY_MODE === 'archive') return;
      __A33_SUMMARY_VIEW_MODE = 'all';
      setSummaryModeBadgePOS();
      syncSummaryPeriodLabelPOS();
      renderSummary();
    });
  }

  const btnBack = document.getElementById('btn-summary-back-live');
  if (btnBack){
    btnBack.addEventListener('click', ()=>{
      exitSummaryArchiveModePOS();
    });
  }

  setSummaryModeBadgePOS();
  syncSummaryPeriodLabelPOS();
  applySummaryArchiveGuardsPOS();
  // Estado del botón Cerrar período (gatekeeper)
  applyClosePeriodGatekeeperUI_POS({ periodKey: getSummarySelectedPeriodKeyPOS() }).catch(_=>{});

  const btnMainExport = document.getElementById('btn-summary-export');
  if (btnMainExport){
    btnMainExport.addEventListener('click', ()=>{ onSummaryExportExcelPOS().catch(err=>{ console.error(err); alert('No se pudo exportar: ' + humanizeError(err)); }); });
  }

  const btnClosePeriod = document.getElementById('btn-summary-close-period');
  if (btnClosePeriod){
    btnClosePeriod.addEventListener('click', ()=>{
      runWithSavingLockPOS({
        key: 'cerrar_período_modal',
        btnIds: ['btn-summary-close-period'],
        labelSaving: 'Procesando…',
        busyToast: 'Procesando…',
        onError: (err)=> console.error(err),
        fn: async()=>{ await openSummaryClosePeriodModalPOS(); }
      });
    });
  }

  const btnArchive = document.getElementById('btn-summary-archive');
  if (btnArchive){
    btnArchive.addEventListener('click', ()=>{ openSummaryArchiveModalPOS().catch(err=>console.error(err)); });
  }

  // Modal close period: click outside
  const mClose = document.getElementById('summary-close-modal');
  if (mClose){
    mClose.addEventListener('click', (e)=>{ if (e.target === mClose) closeSummaryClosePeriodModalPOS(); });
  }
  const btnCancel = document.getElementById('summary-close-cancel');
  if (btnCancel){
    btnCancel.addEventListener('click', ()=> closeSummaryClosePeriodModalPOS());
  }
  const btnExport = document.getElementById('summary-close-export');
  if (btnExport){
    btnExport.addEventListener('click', ()=>{ manualExportClosePeriodPOS().catch(err=>console.error(err)); });
  }
  const btnConfirm = document.getElementById('summary-close-confirm');
  if (btnConfirm){
    btnConfirm.addEventListener('click', ()=>{ confirmClosePeriodPOS().catch(err=>console.error(err)); });
  }

  // Modal archive
  const mArch = document.getElementById('summary-archive-modal');
  if (mArch){
    mArch.addEventListener('click', (e)=>{ if (e.target === mArch) closeSummaryArchiveModalPOS(); });
  }
  const btnArchClose = document.getElementById('summary-archive-close');
  if (btnArchClose){
    btnArchClose.addEventListener('click', ()=> closeSummaryArchiveModalPOS());
  }
  const search = document.getElementById('summary-archive-search');
  if (search){
    search.addEventListener('input', ()=>{ loadAndRenderArchivesPOS().catch(err=>console.error(err)); });
  }

  const btnRefresh = document.getElementById('summary-archive-refresh');
  if (btnRefresh){
    // Force rebuild desde IndexedDB (si hubo cambios fuera de los flujos normales)
    btnRefresh.addEventListener('click', ()=>{ loadAndRenderArchivesPOS({ force: true }).catch(err=>console.error(err)); });
  }

  const btnCons = document.getElementById('summary-archive-consolidated');
  if (btnCons){
    btnCons.addEventListener('click', ()=>{
      setSummaryArchivePanelModePOS('consolidated');
    });
  }

  const btnConsExportGerente = document.getElementById('summary-consolidated-export-gerente');
  if (btnConsExportGerente){
    btnConsExportGerente.addEventListener('click', ()=>{ exportConsolidatedGerenteExcelPOS().catch(err=>console.error(err)); });
  }

  const btnConsBack = document.getElementById('summary-archive-consolidated-back');
  if (btnConsBack){
    btnConsBack.addEventListener('click', ()=>{
      setSummaryArchivePanelModePOS('list');
      loadAndRenderArchivesPOS().catch(err=>console.error(err));
    });
  }
}

function getActiveSummaryPeriodFilterPOS(){
  if (__A33_SUMMARY_VIEW_MODE === 'all') return null;
  return getSummarySelectedPeriodKeyPOS();
}

// CSV helpers
function downloadCSV(name, rows){
  const csv = rows.map(r=>r.map(x=>{
    if (x==null) return '';
    const s = String(x);
    if (/[",\n]/.test(s)) { return '"' + s.replace(/"/g,'""') + '"'; }
    else { return s; }
  }).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);

}

function downloadExcel(filename, sheetName, rows){
  if (typeof XLSX === 'undefined'){
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Si estás sin conexión por primera vez, abrí el POS con internet una vez para cachear todo y reintentá. Revisa tu conexión a internet.');
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Hoja1');
  XLSX.writeFile(wb, filename);
}

async function generateInventoryCSV(eventId){
  if (typeof XLSX === 'undefined'){
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Si estás sin conexión por primera vez, abrí el POS con internet una vez para cachear todo y reintentá. Revisa tu conexión a internet.');
    return;
  }
  const prods = await getAll('products');
  const inv = await getInventoryEntries(eventId);
  const sales = await getAll('sales');
  const rows = [['producto','manejar','inicial','reposiciones','ajustes','vendido','stock_actual']];
  for (const p of prods){
    const inits = inv.filter(i=>i.productId===p.id && i.type==='init').reduce((a,b)=>a+(b.qty||0),0);
    const repo = inv.filter(i=>i.productId===p.id && i.type==='restock').reduce((a,b)=>a+(b.qty||0),0);
    const adj = inv.filter(i=>i.productId===p.id && i.type==='adjust').reduce((a,b)=>a+(b.qty||0),0);
    const sold = sales.filter(s=>s.eventId===eventId && saleMatchesCatalogProductPOS(s, p)).reduce((a,b)=>a+(b.qty||0),0);
    const stock = inits + repo + adj - sold;
    rows.push([p.name, p.manageStock!==false?1:0, inits, repo, adj, sold, stock]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Inventario');

  const rpRows = await reempaqueBuildExportRowsPOS(eventId);
  if (rpRows.length > 1){
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rpRows), 'Reempaque');
  }

  XLSX.writeFile(wb, 'inventario_evento.xlsx');
}

// Eventos UI
async function renderEventos(){
  const filtro = $('#filtro-eventos').value || 'todos';
  const groupSelect = $('#filtro-grupo');
  const tbody = $('#tbl-eventos tbody');
  tbody.innerHTML = '';

  const events = await getAll('events');
  const sales = await getAll('sales');

  // Construir opciones de filtro de grupo
  if (groupSelect){
    const current = groupSelect.value || '';
    const grupos = [];
    let haySinGrupo = false;
    for (const ev of events){
      const g = (ev.groupName || '').trim();
      if (g){
        if (!grupos.includes(g)) grupos.push(g);
      } else {
        haySinGrupo = true;
      }
    }
    grupos.sort((a,b)=>a.localeCompare(b,'es-NI'));
    let opts = '<option value="">Grupos: Todos</option>';
    if (haySinGrupo){
      opts += '<option value="__sin_grupo__">[Sin grupo]</option>';
    }
    for (const g of grupos){
      const esc = g.replace(/"/g,'&quot;');
      opts += `<option value="${esc}">${esc}</option>`;
    }
    groupSelect.innerHTML = opts;
    if (current && Array.from(groupSelect.options).some(o=>o.value===current)){
      groupSelect.value = current;
    }
  }

  const filtroGrupo = groupSelect ? (groupSelect.value || '') : '';

  const rows = events.map(ev=>{
    const tot = sales.filter(s=>s.eventId===ev.id).reduce((a,b)=>a+(b.total||0),0);
    return {...ev, _totalCached: tot};
  }).filter(ev=>{
    if (filtro==='abiertos' && ev.closedAt) return false;
    if (filtro==='cerrados' && !ev.closedAt) return false;

    if (filtroGrupo){
      const g = (ev.groupName || '').trim();
      if (filtroGrupo === '__sin_grupo__'){
        if (g) return false;
      } else {
        if (g !== filtroGrupo) return false;
      }
    }
    return true;
  }).sort((a,b)=>{
    const ad = a.createdAt||''; const bd = b.createdAt||'';
    return (bd>ad) ? 1 : -1;
  });

  for (const ev of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ev.name}</td>
      <td>${(ev.groupName||'')}</td>
      <td>${ev.closedAt?'<span class="tag closed">cerrado</span>':'<span class="tag open">abierto</span>'}</td>
      <td>${ev.createdAt?new Date(ev.createdAt).toLocaleString():''}</td>
      <td>${ev.closedAt?new Date(ev.closedAt).toLocaleString():''}</td>
      <td>C$ ${fmt(ev._totalCached)}</td>
      <td class="actions">
        <button class="act-ver" data-id="${ev.id}">VER</button>
        <button class="act-activar" data-id="${ev.id}">Activar</button>
        ${ev.closedAt?'<button class="act-reabrir" data-id="'+ev.id+'">Reabrir</button>':'<button class="act-cerrar" data-id="'+ev.id+'">Cerrar</button>'}
        <button class="act-corte" data-id="${ev.id}">CSV Corte</button>
        <button class="act-ventas" data-id="${ev.id}">CSV Ventas</button>
        <button class="act-inv" data-id="${ev.id}">CSV Inv</button>
        <button class="act-eliminar btn-danger" data-id="${ev.id}">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}
// Modal VER: rellenar
function showEventView(show){ $('#event-view').style.display = show ? 'flex' : 'none'; }
async function openEventView(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev) return;
  const sales = (await getAll('sales')).filter(s=>s.eventId===eventId);
  // Asegurar N° consecutivo por evento (persistente) para export
  await backfillSaleSeqIdsForEventPOS(eventId, ev, sales);
  // Asegurar N° consecutivo por evento (persistente) para UI/Export
  await backfillSaleSeqIdsForEventPOS(eventId, ev, sales);
  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){ if (b && b.id != null) bankMap.set(Number(b.id), b.name || ''); }

  $('#ev-title').textContent = `Evento: ${ev.name}`;
  $('#ev-meta').innerHTML = `<div><b>Estado:</b> ${ev.closedAt?'Cerrado':'Abierto'}</div>
  <div><b>Creado:</b> ${ev.createdAt?new Date(ev.createdAt).toLocaleString():'—'}</div>
  <div><b>Cerrado:</b> ${ev.closedAt?new Date(ev.closedAt).toLocaleString():'—'}</div>
  <div><b># Ventas:</b> ${sales.length}</div>`;

  const total = sales.reduce((a,b)=> a + (Number(b && b.total) || 0), 0);

  // --- Costos (productos dinámicos: prioriza snapshot guardado; Galón solo para vasos legacy sin productId) ---
  const fbatches = sanitizeFractionBatches(ev && ev.fractionBatches);
  const batchMap = new Map();
  for (const b of fbatches){
    if (b && b.batchId) batchMap.set(String(b.batchId), b);
  }

  const costPerGallon = getCostoUnitarioProducto('Galón');
  const canEstimateCupCost = costPerGallon > 0;

  function estimateCupCostSigned(s){
    const qRaw = Number(s && s.qty) || 0;
    const absQ = Math.abs(qRaw);
    const sign = (s && (s.isReturn || qRaw < 0)) ? -1 : 1;
    if (!(absQ > 0)) return 0;
    if (!canEstimateCupCost) return 0;

    const breakdown = Array.isArray(s && s.fifoBreakdown) ? s.fifoBreakdown : [];
    if (breakdown.length){
      let costAbs = 0;
      for (const it of breakdown){
        if (!it) continue;
        const take = Math.abs(Number(it.cupsTaken || 0));
        if (!(take > 0)) continue;

        let y = 0;
        const b = it.batchId ? batchMap.get(String(it.batchId)) : null;
        if (b && b.yieldCupsPerGallon) y = safeInt(b.yieldCupsPerGallon, 0);
        if (!(y > 0)){
          const mlpc = Number(it.mlPerCup || (b && b.mlPerCup) || 0);
          if (mlpc > 0) y = Math.round(ML_PER_GALON / mlpc);
        }
        if (!(y > 0)) y = 22;

        costAbs += take * (costPerGallon / Math.max(1, y));
      }
      return sign * costAbs;
    }

    // Sin breakdown (caso raro): usamos el último rendimiento conocido o default 22
    const yFallback = safeInt((fbatches.length ? fbatches[fbatches.length-1].yieldCupsPerGallon : 22), 22);
    return sign * absQ * (costPerGallon / Math.max(1, (yFallback > 0 ? yFallback : 22)));
  }

  let costoProductos = 0;

  // Stats cortesías (para mostrar en VER)
  let cortesiasPresU = 0;
  let cortesiasVasosU = 0;
  let costoCortesiasPres = 0;
  let costoCortesiasVasos = 0;

  for (const s of sales) {
    if (!s) continue;
    const qRaw = Number(s.qty || 0);
    const absQty = Math.abs(qRaw);
    const isReturn = !!s.isReturn || qRaw < 0;
    const qtyParaCosto = isReturn ? -absQty : absQty;

    const isCourtesy = !!(s.courtesy || s.isCourtesy);

    if (isCupSaleRecord(s)){
      // Preferir snapshot. Solo registros legacy sin productId pueden estimarse desde Galón/yield.
      const stored = getSaleLineCostSnapshotPOS(s);
      const estimated = isLegacyCupCostFallbackSalePOS(s) ? estimateCupCostSigned(s) : 0;
      const lineCost = (Math.abs(stored) > 1e-9) ? stored : estimated;

      costoProductos += lineCost;

      if (isCourtesy){
        cortesiasVasosU += absQty;
        costoCortesiasVasos += lineCost;
      }
    } else {
      const storedLineCost = getSaleLineCostPOS(s);
      const fallbackUnitCost = getCostoUnitarioProducto(getSaleProductNameSnapshotPOS(s));
      const lineCost = (Math.abs(storedLineCost) > 1e-9)
        ? storedLineCost
        : ((fallbackUnitCost > 0 && qtyParaCosto !== 0) ? (fallbackUnitCost * qtyParaCosto) : 0);

      if (Math.abs(lineCost) > 1e-9) {
        costoProductos += lineCost;

        if (isCourtesy){
          cortesiasPresU += absQty;
          costoCortesiasPres += lineCost;
        }
      } else {
        // Sin costo conocido: igual contar cortesías en unidades
        if (isCourtesy){
          cortesiasPresU += absQty;
        }
      }
    }
  }

  const utilidadBruta = total - costoProductos;

  const byPay = sales.reduce((m,s)=>{ 
    const k = normalizePaymentMethodPOS((s && s.payment) || '') || '';
    m[k] = (m[k] || 0) + (Number(s && s.total) || 0); 
    return m; 
  },{});

  const hayCostoCortesiasVasos = Math.abs(Number(costoCortesiasVasos || 0)) > 1e-9 || canEstimateCupCost;
  const costoCortesiasTotalKnown = costoCortesiasPres + (hayCostoCortesiasVasos ? costoCortesiasVasos : 0);

  $('#ev-totals').innerHTML = `<div><b>Total vendido (pagado):</b> C$ ${fmt(total)}</div>
  <div><b>Cortesías presentaciones:</b> ${Math.round(cortesiasPresU)} unid.</div>
  <div><b>Cortesías vasos:</b> ${Math.round(cortesiasVasosU)} vasos</div>
  <div><b>Costo cortesías presentaciones:</b> C$ ${fmt(costoCortesiasPres)}</div>
  <div><b>Costo cortesías vasos:</b> ${hayCostoCortesiasVasos ? ('C$ ' + fmt(costoCortesiasVasos)) : 'N/D'}</div>
  <div><b>Costo cortesías total:</b> ${hayCostoCortesiasVasos ? ('C$ ' + fmt(costoCortesiasTotalKnown)) : ('C$ ' + fmt(costoCortesiasPres) + ' + N/D')}</div>
  <div><b>Costo estimado de producto:</b> C$ ${fmt(costoProductos)}</div>
  <div><b>Utilidad bruta aprox.:</b> C$ ${fmt(utilidadBruta)}</div>
  <div><b>Efectivo:</b> C$ ${fmt(byPay.efectivo||0)}</div>
  <div><b>Transferencia:</b> C$ ${fmt(byPay.transferencia||0)}</div>
  <div><b>Tarjeta:</b> C$ ${fmt(byPay.tarjeta||0)}</div>
  <div><b>Crédito cliente:</b> C$ ${fmt(byPay.credito||0)}</div>`;

  const byDay = Array.from((()=>{
    const m = new Map();
    for (const s of sales){
      const k = (s && s.date) ? String(s.date) : '';
      if (!k) continue;
      const prev = m.get(k) || 0;
      m.set(k, prev + (Number(s && s.total) || 0));
    }
    return m;
  })().entries()).sort((a,b)=>b[0].localeCompare(a[0]));
  const tbd = $('#ev-byday tbody'); 
  tbd.innerHTML=''; 
  byDay.forEach(([k,v])=>{ 
    const tr=document.createElement('tr'); 
    tr.innerHTML=`<td>${k}</td><td>${fmt(v)}</td>`; 
    tbd.appendChild(tr); 
  });

  // Por producto: mostrar Monto (C$) y, si aplica, unidades (para que "Vaso (Cortesía)" no quede en 0)
  const byProd = Array.from((()=>{
    const m = new Map();
    for (const s of sales){
      const k = (s && getSaleProductNameSnapshotPOS(s)) ? uiProductNamePOS(getSaleProductNameSnapshotPOS(s)) : '—';
      const prev = m.get(k) || { amount: 0, qty: 0 };
      prev.amount += (Number(s && s.total) || 0);
      prev.qty += (Number(s && s.qty) || 0);
      m.set(k, prev);
    }
    return m;
  })().entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  const tbp = $('#ev-byprod tbody'); 
  tbp.innerHTML=''; 
  byProd.forEach(([k,obj])=>{
    const amount = obj ? (Number(obj.amount) || 0) : 0;
    const qty = obj ? (Number(obj.qty) || 0) : 0;

    let val = '';
    if (Math.abs(amount) < 1e-9 && Math.abs(qty) > 1e-9){
      val = `${qty} u`;
    } else if (Math.abs(qty) > 1e-9){
      val = `C$ ${fmt(amount)} · ${qty} u`;
    } else {
      val = `C$ ${fmt(amount)}`;
    }

    const tr=document.createElement('tr'); 
    tr.innerHTML=`<td>${escapeHtml(k)}</td><td>${val}</td>`; 
    tbp.appendChild(tr); 
  });

  const tb = $('#ev-sales tbody'); tb.innerHTML='';
  // Más reciente primero
  sales.sort((a,b)=> (saleSortKeyPOS(b) - saleSortKeyPOS(a))).forEach(s=>{
    const payLabel = getSalePaymentLabelPOS(s, bankMap);
    const tr=document.createElement('tr'); tr.innerHTML = `<td>${getSaleSeqDisplayPOS(s)}</td><td>${s.date}</td><td>${getSaleTimeTextPOS(s)}</td><td>${escapeHtml(uiProductNamePOS(getSaleProductNameSnapshotPOS(s)))}</td><td>${s.qty}</td><td>${fmt(getSaleUnitPriceSnapshotPOS(s))}</td><td>${fmt(getSaleDiscountTotalPOS(s))}</td><td>${fmt(s.total)}</td><td>${payLabel}</td><td>${s.courtesy?'✓':''}</td><td>${s.isReturn?'✓':''}</td><td>${escapeHtml(getSaleCustomerSnapshotNamePOS(s))}</td><td>${s.courtesyTo||''}</td><td>${s.notes||''}</td>`;
    tb.appendChild(tr);
  });

  showEventView(true);
}

// CSV ventas/corte
async function exportEventSalesCSV(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  const sales = (await getAll('sales')).filter(s=>s.eventId===eventId);
  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){ if (b && b.id != null) bankMap.set(Number(b.id), b.name || ''); }

  const rows = [['N°','id','fecha','hora','producto','cant','PU','desc_C$','total','pago','banco','cortesia','devolucion','cortesia_a','notas','cliente']];
  const ordered = [...sales].sort((a,b)=> (saleSortKeyPOS(b) - saleSortKeyPOS(a)));
  for (const s of ordered){
    const bank = isBankPaymentMethodPOS(s.payment) ? getSaleBankLabel(s, bankMap) : '';
    rows.push([ (s.seqId || ''), s.id, s.date, getSaleTimeTextPOS(s), uiProductNamePOS(getSaleProductNameSnapshotPOS(s)), s.qty, getSaleUnitPriceSnapshotPOS(s), getSaleDiscountTotalPOS(s), s.total, getPaymentMethodLabelPOS(s.payment), bank, s.courtesy?1:0, s.isReturn?1:0, s.courtesyTo||'', s.notes||'', getSaleCustomerSnapshotNamePOS(s)]);
  }
  const safeName = (ev?ev.name:'evento').replace(/[^a-z0-9_\- ]/gi,'_');
  downloadExcel(`ventas_${safeName}.xlsx`, 'Ventas', rows);
}
function buildCorteSummaryRows(eName, sales){
  let efectivo=0, trans=0, tarjeta=0, credito=0, descuentos=0, cortesiasU=0, cortesiasVal=0, devolU=0, devolVal=0, bruto=0;
  for (const s of sales){
    const absQty = Math.abs(s.qty||0);
    const absTotal = Math.abs(s.total||0);
    const disc = getSaleDiscountTotalPOS(s);
    bruto += (s.courtesy ? (getSaleUnitPriceSnapshotPOS(s)*absQty) : (absTotal + disc));
    descuentos += disc * (s.isReturn?-1:1);
    if (s.courtesy){ cortesiasU += absQty; cortesiasVal += (getSaleUnitPriceSnapshotPOS(s)*absQty); }
    if (s.isReturn){ devolU += absQty; devolVal += absTotal; }
    const pay = normalizePaymentMethodPOS(s.payment || '');
    if (pay === 'efectivo') efectivo += s.total;
    else if (pay === 'transferencia') trans += s.total;
    else if (pay === 'tarjeta') tarjeta += s.total;
    else if (pay === 'credito'){ credito += s.total; }
  }
  const cobrado = efectivo + trans + tarjeta;
  const neto = cobrado;
  return {efectivo, trans, tarjeta, credito, descuentos, cortesiasU, cortesiasVal, devolU, devolVal, bruto, cobrado, neto};
}
async function generateCorteCSV(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){ alert('Evento no encontrado'); return; }
  const sales = (await getAll('sales')).filter(s=>s.eventId===eventId);
  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){ if (b && b.id != null) bankMap.set(Number(b.id), b.name || ''); }

  // Transferencias por banco
  const transferByBank = new Map();
  for (const s of sales){
    if (normalizePaymentMethodPOS(s.payment || '') !== 'transferencia') continue;
    const label = getSaleBankLabel(s, bankMap);
    const cur = transferByBank.get(label) || { total: 0, count: 0 };
    cur.total += Number(s.total || 0);
    cur.count += 1;
    transferByBank.set(label, cur);
  }
  const sum = buildCorteSummaryRows(ev.name, sales);
  const rows = [];
  rows.push(['Corte de evento', ev.name]);
  rows.push(['Generado', new Date().toLocaleString()]);
  rows.push([]);
  rows.push(['Resumen de cobros']);
  rows.push(['Efectivo', sum.efectivo.toFixed(2)]);
  rows.push(['Transferencia', sum.trans.toFixed(2)]);
  rows.push(['Tarjeta', sum.tarjeta.toFixed(2)]);
  rows.push(['Crédito cliente', sum.credito.toFixed(2)]);
  rows.push(['Cobrado (sin crédito cliente)', sum.cobrado.toFixed(2)]);
  if (transferByBank.size){
    rows.push([]);
    rows.push(['Transferencias por banco']);
    rows.push(['Banco','Total C$','Transacciones']);
    const entries = Array.from(transferByBank.entries())
      .sort((a,b)=> (b[1].total || 0) - (a[1].total || 0));
    for (const [label, obj] of entries){
      rows.push([label, (obj.total || 0).toFixed(2), obj.count || 0]);
    }
  }
  rows.push([]);
  rows.push(['Ajustes']);
  rows.push(['Descuentos aplicados (C$)', sum.descuentos.toFixed(2)]);
  rows.push(['Cortesías (unid.)', sum.cortesiasU]);
  rows.push(['Cortesías valor ref. (C$)', sum.cortesiasVal.toFixed(2)]);
  rows.push(['Devoluciones (unid.)', sum.devolU]);
  rows.push(['Devoluciones (C$)', sum.devolVal.toFixed(2)]);
  rows.push([]);
  rows.push(['Ventas brutas ref. (aprox.)', sum.bruto.toFixed(2)]);
  rows.push(['Neto cobrado', sum.neto.toFixed(2)]);
  rows.push([]);
  rows.push(['Detalle de ventas']);
  rows.push(['id','fecha','hora','producto','cant','PU','desc_C$','total','pago','T/C usado','USD recibido','Vuelto C$','Equivalente C$','banco','cortesia','devolucion','cortesia_a','notas','cliente']);
  for (const s of sales){
    const bank = isBankPaymentMethodPOS(s.payment) ? getSaleBankLabel(s, bankMap) : '';
    const tp = getSaleCashTenderPartsPOS(s);
    rows.push([s.id, s.date, getSaleTimeTextPOS(s), uiProductNamePOS(getSaleProductNameSnapshotPOS(s)), s.qty, getSaleUnitPriceSnapshotPOS(s), getSaleDiscountTotalPOS(s), s.total, getPaymentMethodLabelPOS(s.payment), tp.fx || '', tp.usd || '', tp.change || '', tp.equivalent || '', bank, s.courtesy?1:0, s.isReturn?1:0, s.courtesyTo||'', s.notes||'', getSaleCustomerSnapshotNamePOS(s)]);
  }
  const safeName = ev.name.replace(/[^a-z0-9_\- ]/gi,'_');
  downloadExcel(`corte_${safeName}.xlsx`, 'Corte', rows);
}

async function exportEventExcel(eventId){
  if (typeof XLSX === 'undefined'){
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Si estás sin conexión por primera vez, abrí el POS con internet una vez para cachear todo y reintentá. Revisa tu conexión a internet.');
    return;
  }

  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){
    alert('Evento no encontrado');
    return;
  }

  const allSales = await getAll('sales');
  const sales = allSales.filter(s=>s.eventId===eventId);

  // Asegurar N° consecutivo por evento antes de exportar (persistente)
  try{ await backfillSaleSeqIdsForEventPOS(eventId, ev, sales); }catch(e){ console.warn('backfillSaleSeqIdsForEventPOS (export) failed', e); }

  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){ if (b && b.id != null) bankMap.set(Number(b.id), b.name || ''); }
  const transferByBank = new Map();
  for (const s of sales){
    if (normalizePaymentMethodPOS(s.payment || '') !== 'transferencia') continue;
    const label = getSaleBankLabel(s, bankMap);
    const cur = transferByBank.get(label) || { total: 0, count: 0 };
    cur.total += Number(s.total || 0);
    cur.count += 1;
    transferByBank.set(label, cur);
  }

  // --- Hoja 1: Resumen del evento ---
  const resumenRows = [];
  resumenRows.push(['Evento', ev.name || '']);
  resumenRows.push(['ID', ev.id]);
  resumenRows.push(['Estado', ev.closedAt ? 'Cerrado' : 'Abierto']);
  resumenRows.push(['Creado', ev.createdAt ? new Date(ev.createdAt).toLocaleString() : '']);
  resumenRows.push(['Cerrado', ev.closedAt ? new Date(ev.closedAt).toLocaleString() : '']);
  resumenRows.push([]);

  const totalVentas = sales.reduce((acc,s)=>acc + (s.total || 0), 0);
  resumenRows.push(['Resumen de ventas']);
  resumenRows.push(['Total vendido C$', totalVentas]);

  const byPay = sales.reduce((m,s)=>{
    const pay = normalizePaymentMethodPOS(s.payment || '') || 'desconocido';
    m[pay] = (m[pay] || 0) + (s.total || 0);
    return m;
  },{});
  resumenRows.push([]);
  resumenRows.push(['Cobros por forma de pago']);
  resumenRows.push(['Efectivo C$', byPay.efectivo || 0]);
  resumenRows.push(['Transferencia C$', byPay.transferencia || 0]);
  resumenRows.push(['Tarjeta C$', byPay.tarjeta || 0]);
  resumenRows.push(['Crédito cliente C$', byPay.credito || 0]);

  if (transferByBank.size){
    resumenRows.push([]);
    resumenRows.push(['Transferencias por banco']);
    resumenRows.push(['Banco','Total C$','Transacciones']);
    const entries = Array.from(transferByBank.entries())
      .sort((a,b)=> (b[1].total || 0) - (a[1].total || 0));
    for (const [label, obj] of entries){
      resumenRows.push([label, (obj.total || 0), obj.count || 0]);
    }
  }

  const wb = XLSX.utils.book_new();
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen_Evento');

  // --- Hoja 3 opcional: Ventas_Detalle ---
  const ventasRows = [];
  ventasRows.push(['N°','id','fecha','hora','producto','cantidad','PU_C$','descuento_C$','total_C$','costo_unit_C$','costo_total_C$','pago','T/C usado','USD recibido','Vuelto C$','Equivalente C$','banco','cortesia','devolucion','cortesia_a','notas','cliente']);
  for (const s of sales){
    const qty = Number(s.qty || 0);
    const costUnit = getSaleCostUnitSnapshotPOS(s);
    const costTotal = getSaleLineCostSnapshotPOS(s);
    ventasRows.push([
      getSaleSeqDisplayPOS(s),
      s.id,
      s.date || '',
      getSaleTimeTextPOS(s) || '',
      getSaleProductNameSnapshotPOS(s) || '',
      qty || 0,
      getSaleUnitPriceSnapshotPOS(s) || 0,
      getSaleDiscountTotalPOS(s) || 0,
      s.total || 0,
      costUnit || 0,
      costTotal || 0,
      getPaymentMethodLabelPOS(s.payment),
      getSaleCashTenderPartsPOS(s).fx || '',
      getSaleCashTenderPartsPOS(s).usd || '',
      getSaleCashTenderPartsPOS(s).change || '',
      getSaleCashTenderPartsPOS(s).equivalent || '',
      isBankPaymentMethodPOS(s.payment) ? getSaleBankLabel(s, bankMap) : '',
      s.courtesy ? 1 : 0,
      s.isReturn ? 1 : 0,
      s.courtesyTo || '',
      s.notes || '',
      getSaleCustomerSnapshotNamePOS(s)
    ]);
  }
  const wsVentas = XLSX.utils.aoa_to_sheet(ventasRows);
  XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas_Detalle');

  const rpRows = await reempaqueBuildExportRowsPOS(eventId);
  if (rpRows.length > 1){
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rpRows), 'Reempaque');
  }

  const safeName = (ev.name || 'evento').replace(/[^a-z0-9_\- ]/gi,'_');
  XLSX.writeFile(wb, `evento_${safeName}.xlsx`);
}

// --- Close / Reopen / Activate / Delete ---
async function closeEvent(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){ alert('Evento no encontrado'); return; }
  if (ev.closedAt){ alert('Este evento ya está cerrado.'); return; }

  // Confirmación obligatoria antes de cerrar (anti-error humano)
  {
    const msg = `¿Estás seguro que vas a cerrar el evento “${(ev.name||'Evento')}”?`;
    const ok = await showConfirmClosePOS({ title: 'Cerrar evento', message: msg });
    if (!ok) return;
  }


  // Corte (Excel). Si falla, permitir cerrar de todas formas.
  try{
    await generateCorteCSV(eventId);
  } catch(err){
    console.error('generateCorteCSV error', err);
    const ok = await showConfirmClosePOS({
      title: 'Corte falló',
      message: 'No se pudo generar el Corte (Excel) por un error.\n\n¿Cerrar el evento de todas formas?\n(Podrás exportar después desde Eventos: “Exportar (Excel)” o “CSV Corte”.)'
    });
    if (!ok) return;
  }

  // Etapa 2C: NO mutar estado del evento hasta confirmar persistencia.
  const closedAtIso = new Date().toISOString();
  const evUpdated = Object.assign({}, ev, { closedAt: closedAtIso });
  await put('events', evUpdated);
  try{ ev.closedAt = closedAtIso; }catch(_){ }
  const curId = await getMeta('currentEventId');
  if (curId === eventId){
    // Etapa 2: al dejar evento activo, limpiar cliente
    await resetOperationalStateOnEventSwitchPOS();
    await setMeta('currentEventId', null);
  }
  await refreshEventUI(); await renderEventos(); await renderDay(); await renderSummary();
  toast('Evento cerrado (sin borrar ventas)');
}

async function reopenEvent(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){ alert('Evento no encontrado'); return; }
  ev.closedAt = null;
  await put('events', ev);
  // Etapa 2: limpiar cliente al cambiar evento
  await resetOperationalStateOnEventSwitchPOS();
  await setMeta('currentEventId', eventId);
  await refreshEventUI(); await renderEventos();
  toast('Evento reabierto');
}

async function activateEvent(eventId){
  // Etapa 2: limpiar cliente al cambiar evento
  await resetOperationalStateOnEventSwitchPOS();
  await setMeta('currentEventId', eventId);
  await refreshEventUI();
  await renderDay();
  toast('Evento activado');
}

async function deleteEvent(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){ alert('Evento no encontrado'); return; }
  const msg = '¿Eliminar evento "'+ev.name+'"? Se borrarán sus ventas e inventario. Esta acción NO se puede deshacer.';
  if (!confirm(msg)) return;
  const t = db.transaction(['sales','events','inventory','meta'],'readwrite');
  await new Promise((res)=>{ const r = t.objectStore('sales').getAll(); r.onsuccess = ()=>{ (r.result||[]).filter(s=>s.eventId===eventId).forEach(s=> t.objectStore('sales').delete(s.id)); res(); }; });
  await new Promise((res)=>{ const r = t.objectStore('inventory').getAll(); r.onsuccess = ()=>{ (r.result||[]).filter(i=>i.eventId===eventId).forEach(i=> t.objectStore('inventory').delete(i.id)); res(); }; });
  t.objectStore('events').delete(eventId);
  const mreq = t.objectStore('meta').get('currentEventId');
  mreq.onsuccess = ()=>{ const cur = mreq.result?.value; if (cur === eventId) t.objectStore('meta').put({id:'currentEventId', value:null}); };
  await new Promise((res,rej)=>{ t.oncomplete=res; t.onerror=()=>rej(t.error); });
  await refreshEventUI(); await renderEventos(); await renderDay(); await renderSummary(); await renderInventario(); await renderProductos();
  toast('Evento eliminado');
}

// Botón Restaurar productos base (A33)
async function restoreSeed(){
  toast('Restauración bloqueada: crea Productos en Catálogos → Productos');
  return { ok:false, blocked:true, reason:'catalogos_productos_fuente_unica' };
}

// Init & bindings
async function init(){
  // Paso 1: abrir base de datos POS
  try{
    await openDB();
  }catch(err){
    alert('No se pudo abrir la base de datos del POS. Revisa permisos de almacenamiento del navegador.');
    console.error('INIT openDB ERROR', { name: err && err.name, message: err && err.message, code: err && err.code, phase: err && err.phase, blocked: err && err.blocked, upgradeNeeded: err && err.upgradeNeeded, err });
    return;
  }

  // Nota: no borrar llaves históricas automáticamente
  try{ cleanupHistoricalLocalStoragePOS(); }catch(_){ }

  // Helper para que cada paso falle de forma aislada sin tumbar todo el POS
  const runStep = async (name, fn) => {
    try{
      await fn();
    }catch(err){
      console.error('INIT step error en ' + name, err);
    }
  };

  // Paso 2: defaults y migraciones
  await runStep('ensureDefaults', ensureDefaults);

  // Paso 2.0: navegación por tabs (delegación, idempotente)
  await runStep('bindTabbarOncePOS', async()=>{ bindTabbarOncePOS(); });

  // Paso 2.1: recuperación conservadora de grupos si events quedó vacío
  await runStep('recoverGroupsIfEventsEmpty', ensureGroupsAvailableAtStartupPOS);

  // Paso 3: preparar fecha por defecto
  try{
    const dateInput = document.getElementById('sale-date');
    if (dateInput && !dateInput.value){
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth()+1).padStart(2,'0');
      const d = String(now.getDate()).padStart(2,'0');
      dateInput.value = `${y}-${m}-${d}`;
    }
  }catch(err){
    console.error('INIT step error al configurar fecha por defecto', err);
  }

  // Paso 4: refrescar vistas principales
  await runStep('setupSaleExchangeRateUI', async()=>{ setupSaleExchangeRateUIOnce(); });
  await runStep('setupSaleCashTenderUI', async()=>{ setupSaleCashTenderUIOnce(); });
  await runStep('refreshEventUI', refreshEventUI);
  await runStep('refreshProductSelect', refreshProductSelect);
  await runStep('refreshSaleBankSelect', refreshSaleBankSelect);
  await runStep('renderDay', renderDay);
  await runStep('renderSummary', renderSummary);
  await runStep('renderProductosLegacyNoUi', renderProductos);
  await runStep('renderExtrasUI', renderExtrasUI);
  await runStep('renderBancos', renderBancos);
  await runStep('renderEventos', renderEventos);
  await runStep('renderInventario', renderInventario);
  await runStep('updateSellEnabled', updateSellEnabled);
  await runStep('initCustomerUX', async()=>{ initCustomerUXPOS(); });
  await runStep('initSummaryCustomerFilter', async()=>{ initSummaryCustomerFilterPOS(); });
  await runStep('bindSummaryDailyClose', async()=>{ bindSummaryDailyClosePOS(); });
  await runStep('bindSummaryPeriodCloseArchive', async()=>{ bindSummaryPeriodCloseAndArchivePOS(); });

  // Paso 5: barra offline y eventos de sección
  try{
    setOfflineBar();
  }catch(err){
    console.error('INIT step error en setOfflineBar', err);
  }
  // Deep-link desde Centro de Mando: abrir pestaña específica si viene en la URL
  try{
    const deepTab = getTabFromUrlPOS();
    if (deepTab) setTab(deepTab);
    // Deep-link extra: #checklist-reminders -> checklist + scroll a la card
    const scrollTarget = getDeepScrollTargetFromUrlPOS();
    if (scrollTarget){
      setTab('checklist');
      scheduleScrollToIdPOS(scrollTarget);
    }
  }catch(_){ }

  // Vender tab

  $('#sale-event').addEventListener('change', async()=>{ 
    const val = $('#sale-event').value;
    // Etapa 2: limpiar cliente al cambiar evento
    await resetOperationalStateOnEventSwitchPOS();
    if (val === '') { await setMeta('currentEventId', null); }
    else { await setMeta('currentEventId', parseInt(val,10)); }
    await refreshEventUI(); 
    await refreshSaleStockLabel(); 
    await renderDay();
    try{ await renderSummaryDailyCloseCardPOS(); }catch(e){}
  });
  const groupSelect = $('#event-group-select');
  const groupNewInput = $('#event-group-new');

  // Helper: recordar el último grupo usado (Evento Maestro)
  function rememberGroup(name){
    const g = (name || '').trim();
    if (g && g !== '__new__'){
      setLastGroupName(g);
    }
  }

  if (groupSelect) {
    groupSelect.addEventListener('change', ()=>{
      const v = (groupSelect.value || '').trim();

      // Persistir selección de grupo para que quede por defecto la próxima vez.
      if (v && v !== '__new__') {
        rememberGroup(v);
      }

      const newInput = $('#event-group-new');
      if (!newInput) return;

      if (v === '__new__') {
        newInput.style.display = 'inline-block';

        // Si el último grupo guardado no está en la lista, úsalo como sugerencia.
        const last = getLastGroupName();
        if (last && !Array.from(groupSelect.options).some(o=>o.value===last)) {
          newInput.value = last;
        }

        newInput.focus();
      } else {
        newInput.style.display = 'none';
        newInput.value = '';
      }
    });
  }

  // Si el usuario escribe un grupo nuevo, también lo recordamos.
  if (groupNewInput) {
    const saveTyped = ()=>{
      const t = (groupNewInput.value || '').trim();
      if (t){
        setLastGroupName(t);
        addGroupToCatalogPOS(t);
      }
    };
    groupNewInput.addEventListener('blur', saveTyped);
    groupNewInput.addEventListener('keydown', (ev)=>{
      if (ev.key === 'Enter') {
        ev.preventDefault();
        saveTyped();
      }
    });
  }

  const btnManageGroups = $('#btn-manage-groups');
  if (btnManageGroups) {
    btnManageGroups.addEventListener('click', async ()=>{
      const evs = await getAll('events');
      const hidden = new Set(getHiddenGroups());
      // Usar catálogo persistente (si está vacío, se deriva de eventos actuales)
      const catalog = ensureGroupCatalogFromEventsPOS(evs);
      const visible = (catalog || []).filter(g => g && !hidden.has(g));
      if (!visible.length) {
        alert('No hay grupos disponibles para gestionar.');
        return;
      }
      const msg = 'Grupos actuales:\n' + visible.map((g,i)=> `${i+1}. ${g}`).join('\n') +
                  '\n\nEscribe el número del grupo que deseas ocultar:';
      const choice = prompt(msg);
      if (!choice) return;
      const idxNum = parseInt(choice, 10);
      if (!idxNum || idxNum < 1 || idxNum > visible.length) {
        alert('Selección no válida');
        return;
      }
      hidden.add(visible[idxNum-1]);
      setHiddenGroups(Array.from(hidden));
      await refreshEventUI();
      alert('Grupo ocultado. Ya no aparecerá para nuevos eventos, pero sigue existiendo en el historial.');
    });
  }
  $('#btn-add-event').addEventListener('click', async()=>{
  const name = ($('#new-event').value || '').trim();
  const groupSelect = $('#event-group-select');
  const groupNew = $('#event-group-new');
  let groupName = '';

  if (groupSelect) {
    const v = groupSelect.value;
    if (v === '__new__') {
      if (groupNew) {
        groupName = (groupNew.value || '').trim();
      }
    } else if (v && v !== '__new__') {
      groupName = v.trim();
    }
  }

  if (!name) {
    alert('Escribe un nombre de evento');
    return;
  }

  const id = await put('events', {name, groupName, createdAt:new Date().toISOString()});
  // Etapa 2: limpiar cliente al cambiar evento
  await resetOperationalStateOnEventSwitchPOS();
  await setMeta('currentEventId', id);
  $('#new-event').value = '';

  if (groupNew) {
    groupNew.value = '';
    if (groupSelect && groupSelect.value === '__new__') {
      groupSelect.value = groupName || '';
    }
  }

  if (groupName) {
    setLastGroupName(groupName);
    addGroupToCatalogPOS(groupName);
  }

  await refreshEventUI();
  await renderEventos();
  await renderInventario();
  await renderDay();
  toast('Evento creado');
});
  $('#btn-close-event').addEventListener('click', async()=>{
    await runWithSavingLockPOS({
      key: 'cierre de evento',
      btnIds: ['btn-close-event'],
      labelSaving: 'Guardando…',
      busyToast: 'Cierre en curso…',
      onError: (err)=> showPersistFailPOS('cierre de evento', err),
      fn: async()=>{
        const id = parseInt($('#sale-event').value||'0',10);
        const current = await getMeta('currentEventId');
        const useId = id || current;
        if (!useId) { alert('Selecciona un evento'); return; }
        await closeEvent(parseInt(useId,10));
      }
    });
  });
  $('#btn-reopen-event').addEventListener('click', async()=>{ const val = $('#sale-event').value; const id = parseInt(val||'0',10); if (!id) return alert('Selecciona un evento cerrado'); await reopenEvent(id); });

  $('#sale-product').addEventListener('change', async()=>{
    await setSalePriceFromSelectionPOS();
    updateChipsActiveFromSelectionPOS();
    await refreshSaleStockLabel();
    recomputeTotal();
  });

  // Extras por evento (Vender tab)
  const btnSaveExtra = document.getElementById('btn-save-extra');
  if (btnSaveExtra){
    btnSaveExtra.addEventListener('click', ()=> onSaveExtraPOS().catch(err=>console.error(err)));
  }
  const btnCancelExtra = document.getElementById('btn-cancel-extra');
  if (btnCancelExtra){
    btnCancelExtra.addEventListener('click', ()=> resetExtraFormPOS());
  }
  const btnImportMasterExtra = document.getElementById('btn-import-master-extra');
  if (btnImportMasterExtra){
    btnImportMasterExtra.addEventListener('click', ()=> importMasterExtraToEventPOS().catch(err=>console.error(err)));
  }
  const extrasList = document.getElementById('extras-list');
  if (extrasList){
    extrasList.addEventListener('click', (e)=> onExtrasListClickPOS(e).catch(err=>console.error(err)));
  }
  $('#sale-price').addEventListener('input', recomputeTotal);
  $('#sale-qty').addEventListener('input', recomputeTotal);
  $('#sale-discount').addEventListener('input', recomputeTotal);
  $('#sale-courtesy').addEventListener('change', ()=>{ $('#sale-courtesy-to').disabled = !$('#sale-courtesy').checked; recomputeTotal(); });
  $('#sale-return').addEventListener('change', recomputeTotal);
  $('#sale-payment').addEventListener('change', async ()=>{
    // Cliente ahora es opcional para cualquier método de pago
    await refreshSaleBankSelect();
    try{ refreshSaleCashTenderUiPOS({ forceFx:true }); }catch(_){ }
  });
  $('#sale-date').addEventListener('change', async()=>{
    await renderDay();
    await updateSellEnabled();
    // Mantener fecha de Cierre Diario (Resumen) sincronizada con el día operativo, salvo que el usuario la cambie manualmente.
    try{
      const sd = document.getElementById('summary-close-date');
      if (sd && !sd.dataset.userSet){
        sd.value = $('#sale-date').value;
      }
    }catch(e){}
    try{ await renderSummaryDailyCloseCardPOS(); }catch(e){}
    try{ await refreshSaleStockLabel(); }catch(e){}
    try{ if (window.__A33_ACTIVE_TAB === 'checklist') await renderChecklistTab(); }catch(e){}
    try{ if (window.__A33_ACTIVE_TAB === 'efectivo') await renderEfectivoTab(); }catch(e){}
  });
  const btnGoCaja = document.getElementById('btn-go-caja');
  if (btnGoCaja){
    btnGoCaja.addEventListener('click', ()=>{
      // Ir a Resumen y precargar el día, para reabrir/cerrar (v2) desde el flujo oficial.
      try{
        const dk = getSaleDayKeyPOS();
        const sd = document.getElementById('summary-close-date');
        if (sd){
          sd.value = dk;
          // No marcar como userSet: esto es navegación guiada, no edición manual.
          try{ delete sd.dataset.userSet; }catch(_){ }
        }
      }catch(e){}
      setTab('resumen');
    });
  }

  $('#btn-add').addEventListener('click', ()=>{
    runWithSavingLockPOS({
      key: 'venta',
      btnIds: ['btn-add','btn-add-sticky'],
      labelSaving: 'Guardando…',
      busyToast: 'Guardando venta…',
      onError: (err)=> showPersistFailPOS('venta', err),
      fn: addSale
    });
  });
  const stickyBtn = $('#btn-add-sticky');
  if (stickyBtn) {
    stickyBtn.addEventListener('click', ()=>{
      runWithSavingLockPOS({
        key: 'venta',
        btnIds: ['btn-add','btn-add-sticky'],
        labelSaving: 'Guardando…',
        busyToast: 'Guardando venta…',
        onError: (err)=> showPersistFailPOS('venta', err),
        fn: addSale
      });
    });
  }

  // Flujo legacy de vasos desactivado: Vender solo vende stock existente.

  // Deshacer última venta del día para el evento activo
  $('#btn-undo').addEventListener('click', async ()=>{
    const curId = await getMeta('currentEventId');
    if (!curId) {
      alert('No hay evento activo.');
      return;
    }
    const d = $('#sale-date').value;

    // Candado: si sección está activada y el día está cerrado, NO permitir cambios de ventas
    try{
      const ev = await getEventByIdPOS(curId);
      if (!ev || ev.closedAt){ alert('No hay un evento activo válido.'); return; }
      if (!(await guardSellDayOpenOrToastPOS(ev, d))) return;
    }catch(e){}

    const allSales = await getAll('sales');
    const filtered = allSales.filter(s => s.eventId === curId && s.date === d);
    if (!filtered.length) {
      alert('No hay ventas para deshacer en este día.');
      return;
    }
    const last = filtered.sort((a,b)=> a.id - b.id)[filtered.length - 1];
    if (!confirm('¿Eliminar la última venta registrada?')) return;
    const delRes = await del('sales', last.id);

    // Invalida cache liviano de Consolidado (ventas del período)
    try{
      const pk = periodKeyFromDatePOS(last.date);
      bumpConsolSalesRevPOS(pk);
      clearConsolLiveCachePOS(pk);
    }catch(_){ }
    try{ await revertExtraStockForSaleDeletePOS(last); }catch(e){}
    await renderDay();
    await renderSummary();
    await refreshSaleStockLabel();
    await renderInventario();
    if (delRes && delRes.warnings && delRes.warnings.length){
      alert('Venta eliminada, pero con avisos:\n\n- ' + delRes.warnings.join('\n- '));
    }
    toast('Venta eliminada');

    // FIFO (Etapa 2): re-sincronizar snapshot por evento/lote
    try{
      if (last && presKeyFromProductNamePOS(getSaleProductNameSnapshotPOS(last))) {
        queueLotsUsageSyncPOS(last.eventId).then(res=>{
          if (res && res.ok===false){
            showToast('FIFO/Lotes: no se pudo actualizar el uso de lotes para este evento. Revisa asignación de lotes.', 'error', 7000);
          }
        });
      }
    }catch(_){ }
  });

  // Eliminar una venta específica desde la tabla
  $('#tbl-day').addEventListener('click', async (e)=>{
    const btn = e.target.closest('button.del-sale');
    if (!btn) return;

    const rawId = btn.dataset.id;
    const id = Number(rawId);

    if (!Number.isFinite(id)){
      alert('No pude identificar la venta a eliminar (id inválido). Recarga el POS y vuelve a intentar.');
      return;
    }

    const saleToDelete = (await getAll('sales')).find(s=>s.id===id) || null;
    if (!saleToDelete){
      alert('No pude cargar la venta a eliminar. Recarga el POS y vuelve a intentar.');
      return;
    }

    // Candado: si sección está activada y el día está cerrado, NO permitir cambios de ventas
    try{
      const ev = await getEventByIdPOS(saleToDelete.eventId);
      if (!ev || ev.closedAt){ alert('No hay un evento activo válido.'); return; }
      if (!(await guardSellDayOpenOrToastPOS(ev, saleToDelete.date))) return;
    }catch(e){}

    if (!confirm('¿Eliminar esta venta?')) return;

    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Eliminando…';

    try{
      const delRes = await del('sales', id);

      // Invalida cache liviano de Consolidado (ventas del período)
      try{
        const pk = periodKeyFromDatePOS(saleToDelete.date);
        bumpConsolSalesRevPOS(pk);
        clearConsolLiveCachePOS(pk);
      }catch(_){ }
      try{ if (saleToDelete) await revertExtraStockForSaleDeletePOS(saleToDelete); }catch(e){ console.warn('revertExtraStockForSaleDeletePOS (delete) failed', e); }

      // Refrescar UI
      try{
        await renderDay();
        await renderSummary();
        await refreshSaleStockLabel();
        await renderInventario();
      }catch(uiErr){
        console.error('Error refrescando UI después de eliminar venta', uiErr);
      }

      if (delRes && delRes.warnings && delRes.warnings.length){
        alert('Venta eliminada, pero con avisos:\n\n- ' + delRes.warnings.join('\n- '));
      }

      toast('Venta eliminada');

      // FIFO (Etapa 2): re-sincronizar snapshot por evento/lote
      try{
        if (saleToDelete && presKeyFromProductNamePOS(getSaleProductNameSnapshotPOS(saleToDelete))) {
          queueLotsUsageSyncPOS(saleToDelete.eventId).then(res=>{
            if (res && res.ok===false){
              showToast('FIFO/Lotes: no se pudo actualizar el uso de lotes para este evento. Revisa asignación de lotes.', 'error', 7000);
            }
          });
        }
      }catch(_){ }

    }catch(err){
      console.error('Error eliminando la venta', err);
      alert('No se pudo eliminar la venta.\n\nDetalle: ' + humanizeError(err));
    }finally{
      btn.disabled = false;
      btn.textContent = prevText || 'Eliminar';
    }
  });
  // Stepper
  $('#qty-minus').addEventListener('click', ()=>{ const v = Math.max(1, parseInt($('#sale-qty').value||'1',10) - 1); $('#sale-qty').value = v; recomputeTotal(); });
  $('#qty-plus').addEventListener('click', ()=>{ const v = Math.max(1, parseInt($('#sale-qty').value||'1',10) + 1); $('#sale-qty').value = v; recomputeTotal(); });


  // Productos: administración retirada del POS. Se conserva guardia legacy por si existe HTML antiguo en caché.
  try{ setupProductEditModalPOS(); }catch(_){ }
  const legacyAddProdBtn = document.getElementById('btn-add-prod');
  if (legacyAddProdBtn){
    legacyAddProdBtn.onclick = ()=> toast('Creación bloqueada: usa Catálogos → Productos');
    legacyAddProdBtn.disabled = true;
  }
  const legacyRestoreSeedBtn = document.getElementById('btn-restore-seed');
  if (legacyRestoreSeedBtn){
    legacyRestoreSeedBtn.onclick = restoreSeed;
    legacyRestoreSeedBtn.disabled = true;
  }

  // Bancos: compatibilidad legacy; fuente maestra en Catálogos → Bancos
  const addBankBtn = document.getElementById('btn-add-bank');
  if (addBankBtn){
    addBankBtn.onclick = async ()=>{
      const input = document.getElementById('bank-new-name');
      const typeEl = document.getElementById('bank-new-type');
      const commissionEl = document.getElementById('bank-new-commission');
      const raw = (input?.value || '').trim();
      if (!raw){ alert('Nombre del banco'); return; }

      const type = normalizeBankTypePOS(typeEl?.value || 'transferencia');
      const commissionPct = type === 'tarjeta' ? normalizeBankCommissionPOS(commissionEl?.value || 0) : 0;
      const banks = await getAllBanksSafe();
      const key = normBankName(raw);
      const dup = banks.find(b => normBankName(b?.name) === key && getBankTypePOS(b) === type);
      if (dup){
        if (dup.isActive === false){
          if (confirm('Ese banco ya existe con ese tipo, pero está inactivo. ¿Activarlo?')){
            dup.isActive = true;
            dup.commissionPct = commissionPct;
            dup.updatedAt = new Date().toISOString();
            await put('banks', dup);
            if (input) input.value = '';
            if (commissionEl) commissionEl.value = '0';
            await renderBancos();
            await refreshSaleBankSelect();
            toast('Banco activado');
          }
          return;
        }
        alert('Ese banco ya existe con ese tipo.');
        return;
      }

      await put('banks', { name: raw, isActive: true, type, commissionPct, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      if (input) input.value = '';
      if (commissionEl) commissionEl.value = '0';
      await renderBancos();
      await refreshSaleBankSelect();
      toast('Banco agregado');
    };
  }

  
async function exportEventosExcel(){
  const events = await getAll('events');
  const sales = await getAll('sales');
  const rows = [['id','evento','grupo','estado','creado','cerrado','total']];

  for (const ev of events){
    const tot = sales.filter(s=>s.eventId===ev.id).reduce((a,b)=>a+(b.total||0),0);
    const estado = ev.closedAt ? 'Cerrado' : 'Abierto';
    rows.push([
      ev.id,
      ev.name || '',
      ev.groupName || '',
      estado,
      ev.createdAt || '',
      ev.closedAt || '',
      tot.toFixed ? tot.toFixed(2) : tot
    ]);
  }

  downloadExcel('eventos.xlsx', 'Eventos', rows);
}

// Eventos tab actions
  $('#filtro-eventos').addEventListener('change', renderEventos);
  const filtroGrupoEl = document.getElementById('filtro-grupo');
  if (filtroGrupoEl){
    filtroGrupoEl.addEventListener('change', renderEventos);
  }
  const cierreBtn = document.getElementById('btn-cierre-total');
  if (cierreBtn){
    cierreBtn.addEventListener('click', computeCierreTotalGrupo);
  }
  const cierreExcelBtn = document.getElementById('btn-cierre-total-excel');
  if (cierreExcelBtn){
    cierreExcelBtn.addEventListener('click', exportCierreTotalGrupoExcel);
  }
  $('#btn-exportar-eventos').addEventListener('click', async()=>{
    await exportEventosExcel();
  });
  $('#btn-exportar-evento-excel').addEventListener('click', async()=>{
    const evId = await getMeta('currentEventId');
    if (!evId){
      alert('Debes activar un evento en la pestaña Vender antes de exportar a Excel.');
      return;
    }
    await exportEventExcel(evId);
  });
  $('#tbl-eventos').addEventListener('click', async(e)=>{ const btn = e.target.closest('button'); if (!btn) return; const id = parseInt(btn.dataset.id,10);
    if (btn.classList.contains('act-ver')) await openEventView(id);
    else if (btn.classList.contains('act-activar')) await activateEvent(id);
    else if (btn.classList.contains('act-reabrir')) await reopenEvent(id);
    else if (btn.classList.contains('act-cerrar')){
      // Guardas visibles + anti doble-click
      setBtnSavingStatePOS(btn, true, 'Guardando…');
      await runWithSavingLockPOS({
        key: 'cierre de evento',
        btnIds: ['btn-close-event'],
        labelSaving: 'Guardando…',
        busyToast: 'Cierre en curso…',
        onError: (err)=> showPersistFailPOS('cierre de evento', err),
        fn: async()=>{ await closeEvent(id); }
      });
      setBtnSavingStatePOS(btn, false);
    }
    else if (btn.classList.contains('act-corte')) await generateCorteCSV(id);
    else if (btn.classList.contains('act-ventas')) await exportEventSalesCSV(id);
    else if (btn.classList.contains('act-inv')) await generateInventoryCSV(id);
    else if (btn.classList.contains('act-eliminar')) await deleteEvent(id);
    await renderEventos(); await renderSummary();
  });

  // Modal close
  document.getElementById('ev-close').onclick = ()=> showEventView(false);
  document.getElementById('event-view').addEventListener('click', (e)=>{ if (e.target.id==='event-view') showEventView(false); });

  // Inventario tab
  $('#inv-event').addEventListener('change', renderInventario);
  $('#btn-inv-ref').addEventListener('click', renderInventario);
  $('#btn-inv-csv').addEventListener('click', async()=>{ const id = parseInt($('#inv-event').value||'0',10); if (!id) return alert('Selecciona un evento'); await generateInventoryCSV(id); });
  const btnFromLote = document.getElementById('btn-inv-from-lote');
	  try{ setupInvLoteSelectorModalPOS(); }catch(_){ }
	  if (btnFromLote) btnFromLote.addEventListener('click', openInvLoteSelectorModalPOS);

  // Sobrantes → Lote hijo (Control de Lotes)
  const btnSobrante = document.getElementById('btn-create-sobrante');
  if (btnSobrante) btnSobrante.addEventListener('click', openSobrantePanelPOS);
  const btnSobCancel = document.getElementById('btn-sobrante-cancel');
  if (btnSobCancel) btnSobCancel.addEventListener('click', closeSobrantePanelPOS);
  const btnSobCreate = document.getElementById('btn-sobrante-create');
  if (btnSobCreate) btnSobCreate.addEventListener('click', createSobranteLotPOS);

  // Reverso de asignación (airbag anti-errores)
  const btnRevOpen = document.getElementById('btn-reverse-assign');
  if (btnRevOpen) btnRevOpen.addEventListener('click', async()=>{
    openReversoPanelPOS();
    const evId = parseInt((document.getElementById('inv-event') && document.getElementById('inv-event').value) || '0', 10);
    if (evId) await refreshReversoUIForEventPOS(evId);
  });
  const btnRevCancel = document.getElementById('btn-reverso-cancel');
  if (btnRevCancel) btnRevCancel.addEventListener('click', closeReversoPanelPOS);
  const btnRevDo = document.getElementById('btn-reverso-do');
  if (btnRevDo) btnRevDo.addEventListener('click', reverseAssignSelectedLotePOS);
  const selRev = document.getElementById('reverso-lote-select');
  if (selRev) selRev.addEventListener('change', async()=>{
    const evId = parseInt((document.getElementById('inv-event') && document.getElementById('inv-event').value) || '0', 10);
    if (evId) await updateReversoMetaPOS(evId);
  });

}

// Totales y ventas
function parseNumPOS(v, fallback=0){
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  const cleaned = s.replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
function toggleInvalidBorderPOS(el, isBad){
  try{ if (el && el.classList) el.classList.toggle('a33-invalid', !!isBad); }catch(_){ }
}

function recomputeTotal(){
  const priceEl = $('#sale-price');
  const qtyEl = $('#sale-qty');
  const discEl = $('#sale-discount');

  const priceRaw = parseNumPOS(priceEl ? priceEl.value : '', 0);
  const price = Number.isFinite(priceRaw) ? priceRaw : 0;

  const qtyRaw = parseNumPOS(qtyEl ? qtyEl.value : '', 0);
  const qty = Number.isFinite(qtyRaw) ? Math.max(0, qtyRaw) : 0;

  const discStr = discEl ? String(discEl.value ?? '') : '';
  const discTrim = discStr.trim();
  const discParsed = parseNumPOS(discStr, 0);

  const courtesy = $('#sale-courtesy').checked;
  const isReturn = $('#sale-return').checked;

  const badDiscount =
    (!courtesy && discTrim && !Number.isFinite(discParsed)) ||
    (Number.isFinite(discParsed) && discParsed < 0) ||
    (!courtesy && Number.isFinite(discParsed) && discParsed > price + 1e-9);

  // Bordes: invalidar visualmente el descuento cuando aplica
  toggleInvalidBorderPOS(discEl, badDiscount);

  // Para el cálculo en pantalla, si el input es basura lo tratamos como 0 (pero queda marcado en rojo)
  const discountPerUnit = (Number.isFinite(discParsed) ? Math.max(0, discParsed) : 0);

  // Precio efectivo por unidad luego del descuento fijo
  const effectiveUnit = Math.max(0, price - discountPerUnit);
  let total = effectiveUnit * qty;

  if (courtesy) {
    total = 0;
  }
  if (isReturn) {
    total = -total;
  }

  const t = round2(total).toFixed(2);
  const saleTotalInput = $('#sale-total');
  if (saleTotalInput) {
    saleTotalInput.value = t;
  }
  const stickyEl = $('#sticky-total');
  if (stickyEl) {
    stickyEl.textContent = t;
  }
  try{ updateSaleCashTenderComputedPOS(); }catch(_){ }
}

async function addSale(){
  const curId = await getMeta('currentEventId');
  if (!curId){ alert('Selecciona un evento'); return; }
  const date = $('#sale-date').value;
  const selVal = String($('#sale-product')?.value || '').trim();
  const parsed = parseSelectedSellItemValue(selVal);
  if (parsed && parsed.kind === 'extra'){
    await addExtraSale(parsed.id);
    return;
  }
  const selectedProductId = (parsed && parsed.kind === 'product') ? parsed.productId : '';
  const qtyRaw = parseNumPOS($('#sale-qty').value, 0);
  const qty = Math.abs(qtyRaw);
  const priceRaw = parseNumPOS($('#sale-price').value, 0);
  const price = round2(priceRaw);
  const discStr = ($('#sale-discount') ? $('#sale-discount').value : '');
  const discTrim = String(discStr ?? '').trim();
  const discParsed = parseNumPOS(discStr, 0);
  if (discTrim && !Number.isFinite(discParsed)) { alert('Descuento inválido'); return; }
  if (Number.isFinite(discParsed) && discParsed < 0) { alert('Descuento inválido'); return; }
  const discountPerUnit = Math.max(0, Number.isFinite(discParsed) ? discParsed : 0);
  const payment = normalizePaymentMethodPOS($('#sale-payment').value || 'efectivo');
  const courtesy = $('#sale-courtesy').checked;
  const isReturn = $('#sale-return').checked;
  const customerInputName = getCustomerNameFromUI_POS();
  const customerResolved = resolveCustomerIdForSalePOS(customerInputName, getCustomerIdHintFromUI_POS());
  const customerId = (customerResolved && customerResolved.id) ? customerResolved.id : null;
  const customerName = (customerResolved && customerResolved.id && customerResolved.displayName) ? customerResolved.displayName : '';
  const courtesyTo = $('#sale-courtesy-to').value || '';
  const notes = $('#sale-notes').value || '';
  if (!date || !selectedProductId || !qty) { alert('Completa fecha, producto y cantidad'); return; }

  // Regla final: descuento por unidad NO puede superar el precio unitario (si no es cortesía)
  if (!courtesy && Number.isFinite(price) && discountPerUnit > price + 1e-9) {
    alert('Descuento por unidad no puede ser mayor que el precio unitario');
    return;
  }


  // Etapa 1: confirmación si no hay cliente seleccionado
  if (!confirmProceedSaleWithoutCustomerPOS()) return;

  // Banco obligatorio para Transferencia y Tarjeta
  let bankId = null;
  let bankName = '';
  let bankType = null;
  if (isBankPaymentMethodPOS(payment)){
    const activeBanks = (await getAllBanksSafe()).filter(b => isBankForPaymentPOS(b, payment));
    const label = getPaymentMethodLabelPOS(payment);
    if (!activeBanks.length){
      alert(`No hay bancos activos tipo ${label}. Agregá uno en Catálogos → Bancos.`);
      return;
    }
    const sel = document.getElementById('sale-bank');
    const raw = sel ? String(sel.value || '').trim() : '';
    const id = parseInt(raw || '0', 10);
    if (!id){
      alert(`Selecciona el banco para ${label}.`);
      return;
    }
    const found = activeBanks.find(b => Number(b.id) === id);
    if (!found){
      alert(`Selecciona un banco activo tipo ${label}.`);
      return;
    }
    bankId = id;
    bankName = (found && found.name) ? String(found.name) : '';
    bankType = getBankTypePOS(found);
  }

  const events = await getAll('events');
  const event = events.find(e=>e.id===curId);
  if (!event || event.closedAt){ alert('Este evento está cerrado. Reábrelo o activa otro.'); return; }

  // Candado: si sección está activada y el día está cerrado, NO permitir ventas
  if (!(await guardSellDayOpenOrToastPOS(event, date))) return;

  const products = await getAll('products');
  const prod = findCatalogProductByStableIdPOS(products, selectedProductId);
  if (!prod){
    alert('Producto no encontrado. Actualiza el selector de POS y vuelve a intentar.');
    await refreshProductSelect({ keepSelection:false });
    return;
  }
  if (!productSellableInPOS(prod)){
    alert('Este producto ya no está activo o no está marcado para POS en Catálogos. No se guardó la venta.');
    await refreshProductSelect({ keepSelection:false });
    return;
  }
  const productSnap = buildSaleProductSnapshotPOS(prod, price);
  if (!productSnap.productId || !productSnap.productName){
    alert('Producto inválido: falta ID estable o nombre. Revisa Catálogos.');
    return;
  }
  const productName = productSnap.productName;

  // Etapa 4: Presentaciones con lote → no vender sin lotes asignados/disponibles
  if (!isReturn){
    const lotGuard = await guardLotAvailabilityBeforeSalePOS(curId, productName, qty, productSnap.productId, prod);
    if (lotGuard && lotGuard.presKey){
      if (!lotGuard.ok){
        alert(lotGuard.msg || 'No hay lotes asignados a este evento para vender esta presentación.');
        return;
      }
      if (lotGuard.warn){
        const goLots = confirm(
          `Lotes insuficientes para ${productName}.

` +
          `Disponible en lotes: ${lotGuard.remaining}
` +
          `Intentas vender: ${qty}
` +
          `Faltan: ${lotGuard.faltan}

` +
          `¿Continuar de todos modos?`
        );
        if (!goLots) return;
      }
    }
  }

  if (prod && productManageStockForSalePOS(prod, true) && !isReturn){
    const st = await computeStock(curId, prod);
    if (st < qty){
      const go = confirm(`Stock insuficiente de ${productName}: disponible ${st}, intentas vender ${qty}. ¿Continuar de todos modos?`);
      if (!go) return;
    }
  }

  let subtotal = round2(price * qty);
  // Regla de negocio: descuento total = descuentoPorUnidad × cantidad (cortesía fuerza 0)
  const discountPerUnitEff = courtesy ? 0 : discountPerUnit;
  let discount = round2(discountPerUnitEff * qty);
  let total = courtesy ? 0 : round2(Math.max(0, subtotal - discount));
  const finalQty = isReturn ? -qty : qty;
  if (isReturn) total = -total;

  const costInfo = await resolveSaleUnitCostPOS(curId, productSnap.productId, productName, prod);
  const unitCost = Number(costInfo.unitCost || 0);
  const economicSnapshot = buildSaleEconomicSnapshotPOS({
    unitPrice: price,
    qty: finalQty,
    discount,
    total,
    unitCost,
    costSource: costInfo.source || '',
    courtesy,
    isReturn
  });

  const tenderCheck = validateSaleCashTenderPOS({ payment, total, courtesy, isReturn });
  if (!tenderCheck.ok){
    try{ updateSaleCashTenderComputedPOS(); }catch(_){ }
    alert(tenderCheck.msg || 'Revisa el cobro en efectivo.');
    return;
  }

  const eventName = event ? event.name : 'General';
  const now = new Date(); const time = now.toTimeString().slice(0,5);

  // Nota: inventario central se ajusta SOLO si la venta quedó persistida (evita estados a medias)

  const saleRecord = {
    date,
    time,
    createdAt: Date.now(),
    eventId:curId,
    eventName,
    productId: productSnap.productId,
    productInternalId: productSnap.productInternalId,
    productName: productSnap.productName,
    productNameSnapshot: productSnap.productNameSnapshot,
    unitPrice: productSnap.unitPrice,
    unitPriceSnapshot: productSnap.unitPriceSnapshot,
    productSnapshot: productSnap.productSnapshot,
    qty:finalQty,
    discount,
    discountPerUnit: discountPerUnitEff,
    payment,
    bankId: isBankPaymentMethodPOS(payment) ? bankId : null,
    bankName: isBankPaymentMethodPOS(payment) ? bankName : null,
    bankType: isBankPaymentMethodPOS(payment) ? bankType : null,
    courtesy,
    isReturn,
    // Compat: mantenemos "customer" y añadimos "customerName" (nuevo)
    customer: customerName,
    customerName,
    customerId,
    courtesyTo,
    total,
    notes,
    ...economicSnapshot,
    economicSnapshot: {
      productId: productSnap.productId,
      productName: productSnap.productNameSnapshot,
      unitPriceSnapshot: productSnap.unitPriceSnapshot,
      qty: finalQty,
      subtotal: economicSnapshot.subtotal,
      discountTotal: economicSnapshot.discountTotal,
      ventaNeta: economicSnapshot.ventaNeta,
      costPerUnit: economicSnapshot.costPerUnit,
      costTotal: economicSnapshot.costTotal,
      utilidad: economicSnapshot.utilidad,
      costSource: economicSnapshot.costSourceSnapshot,
      capturedAt: new Date().toISOString()
    }
  };
  applySaleCashTenderToRecordPOS(saleRecord, tenderCheck.tender);

  // Validación mínima (bloqueante antes de guardar)
  const vMin = validateSaleMinimalPOS(saleRecord);
  if (!vMin.ok){ alert(vMin.msg); return; }

  // Etapa 2D: UID estable por intento + dedupe conservador (antes de insertar)
  try{
    const fp = saleFingerprintPOS(saleRecord);
    const uid = getOrCreatePendingSaleUidPOS(fp);
    saleRecord.uid = uid;
    const existing = await getSaleByUidPOS(uid);
    if (existing){
      clearPendingSaleUidPOS();
      try{ await renderDay(); await renderSummary(); }catch(_){ }
      try{ if (typeof showToast === 'function') showToast('Venta ya guardada (duplicado bloqueado).', 'error', 4500); else alert('Venta ya guardada (duplicado bloqueado).'); }catch(_){ try{ alert('Venta ya guardada (duplicado bloqueado).'); }catch(__){ } }
      return;
    }
  }catch(_){ }

  // Reservar N° por evento en memoria y guardar atómico (sales + events)
  try{
    const allSales = await getAll('sales');
    const salesForEvent = (allSales || []).filter(s => s && s.eventId === curId);
    const seqInfo = reserveSaleSeqInMemoryPOS(event, saleRecord, salesForEvent);
    const evUpdated = (seqInfo && seqInfo.eventUpdated) ? seqInfo.eventUpdated : event;
    const saleId = await saveSaleAndEventAtomicPOS({ saleRecord, eventUpdated: evUpdated });
    saleRecord.id = saleId;
    // Commit en memoria SOLO después de persistir
    try{ if (seqInfo && seqInfo.nextSeq != null) event.saleSeq = seqInfo.nextSeq; }catch(_){ }
  }catch(err){
    console.error('addSale persist error', err);
    showPersistFailPOS('venta', err);
    return;
  }

  // Invalida cache liviano de Consolidado (ventas del período actual)
  try{
    const pk = periodKeyFromDatePOS(saleRecord.date);
    bumpConsolSalesRevPOS(pk);
    clearConsolLiveCachePOS(pk);
  }catch(_){ }

  // Ajustar inventario central de producto terminado (post-commit)
  try{
    applyFinishedFromSalePOS(saleRecord, +1);
  }catch(e){
    console.error('Inventario central: no se pudo registrar salida (venta ya guardada)', e);
    posBlockingAlert('Venta guardada, pero no se pudo actualizar Inventario central (storage lleno o bloqueado). Libera espacio y recarga.');
  }

  // Crear/actualizar asiento contable automático en Finanzas
  try {
    await createJournalEntryForSalePOS(saleRecord);
  } catch (err) {
    console.error('No se pudo generar el asiento automático de esta venta', err);
    // Error visible (no silencioso): la venta ya quedó guardada, pero Finanzas no.
    try{ showToast('Venta guardada, pero falló el registro automático en Finanzas. Revisá y reintenta si aplica.', 'error', 6500); }catch(_){ }
  }

  // limpiar campos para el siguiente registro (incluye NOTAS)
  $('#sale-qty').value=1; 
  $('#sale-discount').value=0; 
  afterSaleCustomerHousekeepingPOS(customerName, customerId);
  $('#sale-courtesy-to').value='';
  $('#sale-notes').value=''; // limpiar notas
  try{ $('#sale-payment').value = 'efectivo'; await refreshSaleBankSelect(); }catch(_){ }
  try{ resetSaleCashTenderPOS(); }catch(_){ }
  const nextTotal = (courtesy?0:price).toFixed(2);
  const saleTotal2 = $('#sale-total');
  if (saleTotal2) {
    saleTotal2.value = nextTotal;
  }
  const sticky2 = $('#sticky-total');
  if (sticky2) {
    sticky2.textContent = nextTotal;
  }

  await renderDay(); await renderSummary(); await refreshSaleStockLabel(); await renderInventario();
  toast('Venta agregada');
  try{ if (saleRecord.costWarning) showToast(saleRecord.costWarning, 'error', 6500); }catch(_){ }


  // Etapa 2D: limpieza de UID pendiente (venta completada)
  clearPendingSaleUidPOS();

  // FIFO (Etapa 2): persistir snapshot por evento/lote (solo si aplica a presentaciones)
  try{
    if (presKeyFromProductNamePOS(productName)) {
      queueLotsUsageSyncPOS(curId).then(res=>{
        if (res && res.ok===false){
          showToast('FIFO/Lotes: no se pudo actualizar el uso de lotes para este evento. Revisa asignación de lotes.', 'error', 7000);
        }
      });
    }
  }catch(_){ }

}


async function addExtraSale(extraId){
  const curId = await getMeta('currentEventId');
  if (!curId){ alert('Selecciona un evento'); return; }

  const ev = await getEventByIdPOS(curId);
  if (!ev || ev.closedAt){ alert('No hay un evento activo válido'); return; }

  const date = $('#sale-date').value;
  const qtyIn = parseFloat($('#sale-qty').value||'0');
  const qty = Math.abs(qtyIn);
  const discountPerUnit = Math.max(0, parseFloat($('#sale-discount').value||'0'));
  const payment = normalizePaymentMethodPOS($('#sale-payment').value || 'efectivo');
  const courtesy = $('#sale-courtesy').checked;
  const isReturn = $('#sale-return').checked;
  const customerInputName = getCustomerNameFromUI_POS();
  const customerResolved = resolveCustomerIdForSalePOS(customerInputName, getCustomerIdHintFromUI_POS());
  const customerId = (customerResolved && customerResolved.id) ? customerResolved.id : null;
  const customerName = (customerResolved && customerResolved.id && customerResolved.displayName) ? customerResolved.displayName : '';
  const courtesyTo = $('#sale-courtesy-to').value || '';
  const notes = $('#sale-notes').value || '';

  if (!date || !qty) { alert('Completa fecha y cantidad'); return; }

  // Etapa 1: confirmación si no hay cliente seleccionado
  if (!confirmProceedSaleWithoutCustomerPOS()) return;

  // Candado: si el día está cerrado (sección o Resumen), NO permitir ventas
  if (!(await guardSellDayOpenOrToastPOS(ev, date))) return;

  // Candado: si sección está activada y el día está cerrado, NO permitir ventas
  if (!(await guardSellDayOpenOrToastPOS(ev, date))) return;

  // Banco obligatorio para Transferencia y Tarjeta
  let bankId = null;
  let bankName = '';
  let bankType = null;
  if (isBankPaymentMethodPOS(payment)){
    const activeBanks = (await getAllBanksSafe()).filter(b => isBankForPaymentPOS(b, payment));
    const label = getPaymentMethodLabelPOS(payment);
    if (!activeBanks.length){
      alert(`No hay bancos activos tipo ${label}. Agregá uno en Catálogos → Bancos.`);
      return;
    }
    const sel = document.getElementById('sale-bank');
    const raw = sel ? String(sel.value || '').trim() : '';
    const id = parseInt(raw || '0', 10);
    if (!id){
      alert(`Selecciona el banco para ${label}.`);
      return;
    }
    const found = activeBanks.find(b => Number(b.id) === id);
    if (!found){
      alert(`Selecciona un banco activo tipo ${label}.`);
      return;
    }
    bankId = id;
    bankName = (found && found.name) ? String(found.name) : '';
    bankType = getBankTypePOS(found);
  }

  const extras = sanitizeExtrasPOS(ev.extras).filter(x=>x && x.active!==false);
  const extra = extras.find(x=>Number(x.id)===Number(extraId));
  if (!extra){
    alert('Extra no encontrado.');
    await renderExtrasUI();
    await refreshProductSelect({ keepSelection:true });
    return;
  }

  const unitPrice = Number(extra.unitPrice)||0;
  const effectiveUnit = Math.max(0, unitPrice - discountPerUnit);
  let total = effectiveUnit * qty;
  if (courtesy) total = 0;
  if (isReturn) total = -total;

  // Descuento total (compatibilidad con UI/exports)
  const discount = courtesy ? 0 : (discountPerUnit * qty);

  const finalQty = isReturn ? -qty : qty;

  // Validar stock (para ventas normales y cortesías)
  if (finalQty > 0) {
    const stockNow = Number(extra.stock)||0;
    if (stockNow < finalQty) {
      const want = confirm(
        'Stock insuficiente para "' + extra.name + '".\n\n' +
        'Stock actual: ' + stockNow + '\n' +
        'Requerido: ' + finalQty + '\n\n' +
        '¿Deseas agregar stock ahora?'
      );
      if (want) {
        const suggest = String(Math.max(0, finalQty - stockNow));
        const rawAdd = prompt('Cantidad a agregar:', suggest);
        const addQty = parseFloat(rawAdd || '0');
        if (addQty > 0) {
          extra.stock = stockNow + addQty;
        }
      }
      if ((Number(extra.stock)||0) < finalQty) {
        alert('Stock insuficiente. Agregá stock y volvé a intentar.');
        await renderExtrasUI();
        await refreshSaleStockLabel();
        return;
      }
    }
  }

  // Descontar / revertir stock
  extra.stock = (Number(extra.stock)||0) - finalQty;
  extra.updatedAt = Date.now();
  ev.extras = extras;
  // Nota: persistencia de stock+venta se hace atómica (events+sales) para evitar estados a medias

  // Construir venta (costo congelado)
  const now = new Date();
  const time = now.toTimeString().slice(0,5);

  const costPerUnit = Number(extra.unitCost)||0;
  const economicSnapshot = buildSaleEconomicSnapshotPOS({
    unitPrice,
    qty: finalQty,
    discount,
    total,
    unitCost: costPerUnit,
    costSource: costPerUnit > 0 ? 'extra_catalogo' : 'sin_costo_confiable',
    courtesy,
    isReturn
  });

  const tenderCheck = validateSaleCashTenderPOS({ payment, total, courtesy, isReturn });
  if (!tenderCheck.ok){
    // Revertir stock en memoria: aún no se ha persistido.
    try{ extra.stock = (Number(extra.stock)||0) + finalQty; }catch(_){ }
    try{ updateSaleCashTenderComputedPOS(); }catch(_){ }
    alert(tenderCheck.msg || 'Revisa el cobro en efectivo.');
    return;
  }

  const saleRecord = {
    id: Date.now(),
    eventId: curId,
    eventName: ev.name,
    date,
    time,
    productId: null,
    productName: extra.name,
    productNameSnapshot: extra.name,
    isExtra: true,
    extraId: extra.id,
    extraSnapshot: {
      kind: 'extra',
      extraId: extra.id,
      name: extra.name,
      unitPrice,
      unitCost: costPerUnit,
      capturedAt: new Date().toISOString()
    },
    qty: finalQty,
    unitPrice,
    unitPriceSnapshot: unitPrice,
    discount,
    discountPerUnit,
    total,
    payment,
    bankId,
    bankName,
    bankType,
    // Compat: mantenemos "customer" y añadimos "customerName" (nuevo)
    customer: customerName,
    customerName,
    customerId,
    courtesy,
    courtesyTo,
    notes,
    isReturn,
    createdAt: Date.now(),
    ...economicSnapshot,
    economicSnapshot: {
      kind: 'extra',
      extraId: extra.id,
      productName: extra.name,
      unitPriceSnapshot: unitPrice,
      qty: finalQty,
      subtotal: economicSnapshot.subtotal,
      discountTotal: economicSnapshot.discountTotal,
      ventaNeta: economicSnapshot.ventaNeta,
      costPerUnit: economicSnapshot.costPerUnit,
      costTotal: economicSnapshot.costTotal,
      utilidad: economicSnapshot.utilidad,
      costSource: economicSnapshot.costSourceSnapshot,
      capturedAt: new Date().toISOString()
    }
  };
  applySaleCashTenderToRecordPOS(saleRecord, tenderCheck.tender);

  // Validación mínima (bloqueante antes de guardar)
  const vMin = validateSaleMinimalPOS(saleRecord);
  if (!vMin.ok){ alert(vMin.msg); return; }

  // Etapa 2D: UID estable por intento + dedupe conservador (antes de insertar)
  try{
    const fp = saleFingerprintPOS(saleRecord);
    const uid = getOrCreatePendingSaleUidPOS(fp);
    saleRecord.uid = uid;
    const existing = await getSaleByUidPOS(uid);
    if (existing){
      // Revertir stock en memoria (aún no persistido) para evitar UI confusa
      try{ if (typeof extra !== 'undefined' && extra) extra.stock = (Number(extra.stock)||0) + finalQty; }catch(_){ }
      clearPendingSaleUidPOS();
      try{ await renderDay(); await renderSummary(); }catch(_){ }
      try{ await renderExtrasUI(); await refreshProductSelect({ keepSelection:true }); await refreshSaleStockLabel(); }catch(_){ }
      try{ if (typeof showToast === 'function') showToast('Venta ya guardada (duplicado bloqueado).', 'error', 4500); else alert('Venta ya guardada (duplicado bloqueado).'); }catch(_){ try{ alert('Venta ya guardada (duplicado bloqueado).'); }catch(__){ } }
      return;
    }
  }catch(_){ }

  // Reservar N° por evento en memoria y guardar atómico (events + sales)
  try{
    const allSales = await getAll('sales');
    const salesForEvent = (allSales || []).filter(s => s && s.eventId === curId);
    const seqInfo = reserveSaleSeqInMemoryPOS(ev, saleRecord, salesForEvent);
    const evUpdated = (seqInfo && seqInfo.eventUpdated) ? seqInfo.eventUpdated : ev;
    await saveSaleAndEventAtomicPOS({ saleRecord, eventUpdated: evUpdated });
    // Commit en memoria SOLO después de persistir
    try{ if (seqInfo && seqInfo.nextSeq != null) ev.saleSeq = seqInfo.nextSeq; }catch(_){ }
  }catch(err){
    console.error('addExtraSale persist error', err);
    showPersistFailPOS('venta extra', err);
    await renderExtrasUI();
    await refreshSaleStockLabel();
    return;
  }

  // Invalida cache liviano de Consolidado (ventas del período actual)
  try{
    const pk = periodKeyFromDatePOS(saleRecord.date);
    bumpConsolSalesRevPOS(pk);
    clearConsolLiveCachePOS(pk);
  }catch(_){ }

  // Crear/actualizar asiento contable automático en Finanzas
  try{
    await createJournalEntryForSalePOS(saleRecord);
  }catch(err){
    console.error('No se pudo generar el asiento automático de esta venta de Extra', err);
    // Error visible (no silencioso): la venta ya quedó guardada, pero Finanzas no.
    try{ showToast('Venta guardada, pero falló el registro automático en Finanzas (Extra).', 'error', 6500); }catch(_){ }
  }

  // Cliente: catálogo + modo pegajoso
  afterSaleCustomerHousekeepingPOS(customerName, customerId);

  // Reset mínimos
  $('#sale-qty').value = '1';
  $('#sale-discount').value = '0';
  $('#sale-courtesy').checked = false;
  $('#sale-courtesy-to').disabled = true;
  $('#sale-courtesy-to').value = '';
  $('#sale-notes').value = '';
  $('#sale-return').checked = false;
  try{ $('#sale-payment').value = 'efectivo'; await refreshSaleBankSelect(); }catch(_){ }
  try{ resetSaleCashTenderPOS(); }catch(_){ }

  await renderDay();
  await renderSummary();
  await renderExtrasUI();
  await refreshProductSelect({ keepSelection:true });

  toast(courtesy ? 'Cortesía de Extra registrada' : 'Venta de Extra registrada');
  try{ if (saleRecord.costWarning) showToast(saleRecord.costWarning, 'error', 6500); }catch(_){ }


  // Etapa 2D: limpieza de UID pendiente (venta completada)
  clearPendingSaleUidPOS();
}



async function getCierreTotalGrupoData(){
  const groupSelect = $('#filtro-grupo');
  if (!groupSelect){
    alert('No se encontró el filtro de grupo en la pestaña de eventos.');
    return null;
  }
  const groupVal = groupSelect.value || '';
  if (!groupVal){
    alert('Selecciona un grupo en la lista "Grupos" para generar el cierre total.');
    return null;
  }

  const events = await getAll('events');
  let selectedEvents;
  let groupLabel;
  if (groupVal === '__sin_grupo__'){
    selectedEvents = events.filter(ev => !(ev.groupName || '').trim());
    groupLabel = '[Sin grupo]';
  } else {
    selectedEvents = events.filter(ev => (ev.groupName || '').trim() === groupVal);
    groupLabel = groupVal;
  }
  if (!selectedEvents.length){
    alert('No hay eventos para ese grupo.');
    return null;
  }

  const sales = await getAll('sales');
  const eventIds = new Set(selectedEvents.map(ev=>ev.id));
  const salesGrupo = sales.filter(s => eventIds.has(s.eventId));

  const data = {
    groupValue: groupVal,
    groupLabel,
    eventos: [],
    totalGrupo: 0,
    porPago: {},
    transferByBank: [],
    cortesiasUnid: 0,
    devolUnid: 0,
    devolMonto: 0,
    presentaciones: [],
  };

  if (!salesGrupo.length){
    data.eventos = selectedEvents.map(ev => ({
      id: ev.id,
      name: ev.name || '',
      createdAt: ev.createdAt || '',
      closedAt: ev.closedAt || '',
      total: 0
    }));
    return data;
  }

  const totalsPorEvento = new Map();
  for (const ev of selectedEvents){
    totalsPorEvento.set(ev.id, 0);
  }

  const presentacionesMap = new Map();

  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){
    if (b && b.id != null) bankMap.set(Number(b.id), b.name || '');
  }
  const transferByBankMap = new Map();


  for (const s of salesGrupo){
    const t = s.total || 0;
    const qty = s.qty || 0;
    const pago = normalizePaymentMethodPOS(s.payment || '') || 'otro';

    data.totalGrupo += t;
    if (!data.porPago[pago]) data.porPago[pago] = 0;
    data.porPago[pago] += t;

    if (normalizePaymentMethodPOS(s.payment || '') === 'transferencia'){
      const label = getSaleBankLabel(s, bankMap);
      const cur = transferByBankMap.get(label) || { total: 0, count: 0 };
      cur.total += Number(s.total || 0);
      cur.count += 1;
      transferByBankMap.set(label, cur);
    }

    if (s.courtesy){
      data.cortesiasUnid += Math.abs(qty);
    }
    if (s.isReturn){
      data.devolUnid += Math.abs(qty);
      data.devolMonto += Math.abs(t);
    }

    if (totalsPorEvento.has(s.eventId)){
      totalsPorEvento.set(s.eventId, totalsPorEvento.get(s.eventId) + t);
    }

    if (!s.courtesy && !s.isReturn){
      const nombre = s.productName || 'N/D';
      let acc = presentacionesMap.get(nombre);
      if (!acc) acc = { unidades: 0, monto: 0 };
      acc.unidades += qty;
      acc.monto += t;
      presentacionesMap.set(nombre, acc);
    }
  }

  data.eventos = selectedEvents.map(ev => ({
    id: ev.id,
    name: ev.name || '',
    createdAt: ev.createdAt || '',
    closedAt: ev.closedAt || '',
    total: totalsPorEvento.get(ev.id) || 0
  }));

  data.transferByBank = Array.from(transferByBankMap.entries())
    .map(([bank, obj]) => ({ bank, total: Number(obj.total || 0), count: obj.count || 0 }))
    .sort((a,b)=> (b.total - a.total));

  data.presentaciones = Array.from(presentacionesMap.entries()).map(([name, info]) => ({
    name,
    unidades: info.unidades,
    monto: info.monto
  }));
  return data;
}

async function computeCierreTotalGrupo(){
  const data = await getCierreTotalGrupoData();
  if (!data) return;

  const resumenEl = document.getElementById('cierre-total-resumen');
  const presEl = document.getElementById('cierre-total-presentaciones');
  if (!resumenEl || !presEl) return;

  if (!data.eventos.length && !data.totalGrupo && !Object.keys(data.porPago).length){
    resumenEl.innerHTML = '<p class="muted">No hay ventas registradas para este grupo.</p>';
    presEl.innerHTML = '';
    return;
  }

  let html = '';
  html += `<div><strong>Grupo:</strong> ${data.groupLabel}</div>`;
  html += `<div><strong>Eventos incluidos:</strong> ${data.eventos.length}</div>`;

  html += `<div><strong>Ventas totales del grupo:</strong> C$ ${fmt(data.totalGrupo)}</div>`;
  html += '<hr>';
  html += '<div><strong>Por forma de pago:</strong></div>';
  html += '<ul>';

  const ordenPagos = ['efectivo','transferencia','tarjeta','credito'];
  const ya = new Set();
  for (const metodo of ordenPagos){
    if (data.porPago[metodo] != null){
      html += `<li>${getPaymentMethodLabelPOS(metodo)}: C$ ${fmt(data.porPago[metodo])}</li>`;
      ya.add(metodo);
    }
  }
  for (const metodo in data.porPago){
    if (!ya.has(metodo)){
      html += `<li>${getPaymentMethodLabelPOS(metodo)}: C$ ${fmt(data.porPago[metodo])}</li>`;
    }
  }
  html += '</ul>';

  if (data.transferByBank && Array.isArray(data.transferByBank) && data.transferByBank.length){
    html += '<div><strong>Transferencias por banco:</strong></div>';
    html += '<table class="table small"><thead><tr><th>Banco</th><th>Total C$</th><th>#</th></tr></thead><tbody>';
    const entries = data.transferByBank.slice().sort((a,b)=> (Number(b.total||0) - Number(a.total||0)));
    for (const it of entries){
      html += `<tr><td>${it.bank}</td><td>C$ ${fmt(it.total||0)}</td><td>${it.count||0}</td></tr>`;
    }
    html += '</tbody></table>';
  }
  html += `<div><strong>Cortesías (unidades):</strong> ${data.cortesiasUnid}</div>`;
  html += `<div><strong>Devoluciones:</strong> ${data.devolUnid} u. | C$ ${fmt(data.devolMonto)}</div>`;

  resumenEl.innerHTML = html;

  if (!data.presentaciones.length){
    presEl.innerHTML = '<p class="muted">No hay ventas normales (sin cortesías ni devoluciones) en este grupo.</p>';
  } else {
    const rows = data.presentaciones.slice().sort((a,b)=>a.name.localeCompare(b.name,'es-NI'));
    let tabla = '<table class="table small"><thead><tr><th>Presentación</th><th>Unidades vendidas</th><th>Ventas C$</th></tr></thead><tbody>';
    for (const p of rows){
      tabla += `<tr><td>${p.name}</td><td>${p.unidades}</td><td>C$ ${fmt(p.monto)}</td></tr>`;
    }
    tabla += '</tbody></table>';
    presEl.innerHTML = tabla;
  }
}

async function exportCierreTotalGrupoExcel(){
  const data = await getCierreTotalGrupoData();
  if (!data) return;

  if (typeof XLSX === 'undefined'){
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Si estás sin conexión por primera vez, abrí el POS con internet una vez para cachear todo y reintentá. Revisa tu conexión a internet.');
    return;
  }

  const sheets = [];

  // Hoja Resumen
  const resumenRows = [];
  resumenRows.push(['Grupo', data.groupLabel]);
  resumenRows.push(['Eventos incluidos', data.eventos.length]);
  resumenRows.push(['Ventas totales del grupo (C$)', data.totalGrupo]);
  resumenRows.push([]);
  resumenRows.push(['Forma de pago', 'Monto C$']);

  const ordenPagos = ['efectivo','transferencia','tarjeta','credito'];
  const ya = new Set();
  for (const metodo of ordenPagos){
    if (data.porPago[metodo] != null){
      resumenRows.push([getPaymentMethodLabelPOS(metodo), data.porPago[metodo]]);
      ya.add(metodo);
    }
  }
  for (const metodo in data.porPago){
    if (!ya.has(metodo)){
      resumenRows.push([getPaymentMethodLabelPOS(metodo), data.porPago[metodo]]);
    }
  }
  resumenRows.push([]);
  if (data.transferByBank && Array.isArray(data.transferByBank) && data.transferByBank.length){
    resumenRows.push(['Transferencias por banco']);
    resumenRows.push(['Banco','Total C$','Transacciones']);
    const entries = data.transferByBank.slice().sort((a,b)=> (Number(b.total||0) - Number(a.total||0)));
    for (const it of entries){
      resumenRows.push([it.bank, it.total || 0, it.count || 0]);
    }
  }
  resumenRows.push(['Cortesías (unidades)', data.cortesiasUnid]);
  resumenRows.push(['Devoluciones unidades', data.devolUnid]);
  resumenRows.push(['Devoluciones monto C$', data.devolMonto]);
  sheets.push({ name: 'Resumen', rows: resumenRows });

  // Hoja Eventos
  const eventosRows = [];
  eventosRows.push(['id','evento','creado','cerrado','total C$']);
  for (const ev of data.eventos){
    eventosRows.push([
      ev.id,
      ev.name,
      ev.createdAt,
      ev.closedAt,
      ev.total
    ]);
  }
  sheets.push({ name: 'Eventos', rows: eventosRows });

  // Hoja Presentaciones
  const presRows = [];
  presRows.push(['presentacion','unidades vendidas','ventas C$']);
  if (data.presentaciones.length){
    for (const p of data.presentaciones){
      presRows.push([p.name, p.unidades, p.monto]);
    }
  }
  sheets.push({ name: 'Presentaciones', rows: presRows });

  const wb = XLSX.utils.book_new();
  for (const sh of sheets){
    const ws = XLSX.utils.aoa_to_sheet(sh.rows);
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  }

  const safeGroup = data.groupLabel.replace(/[\\/:*?\[\]]/g,' ');
  const filename = `cierre_total_${safeGroup || 'grupo'}.xlsx`;
  XLSX.writeFile(wb, filename);
}


// -----------------------------
// POS · Calculadora (tab) — lógica aislada
// -----------------------------

let __A33_POS_CALC_INIT = false;

function posCalcTrimDec(s){
  const t = String(s || '');
  if (!t.includes('.')) return t || '0';
  return t.replace(/0+$/,'').replace(/\.$/,'') || '0';
}


function posCalcParsePositiveNumber(raw){
  const s0 = String(raw == null ? '' : raw).trim();
  if (!s0) return null;
  const s = s0.replace(/,/g, '.');
  const n = Number(s);
  return (Number.isFinite(n) && n > 0) ? n : null;
}

function posCalcReadNum(el){
  if (!el) return null;
  const raw0 = String(el.value || '').trim();
  if (!raw0) return null;
  const raw = raw0.replace(/,/g, '.');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function posCalcFmt2(n){
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return (Math.round(x * 100) / 100).toFixed(2);
}

// REQUISITO CLAVE: source of truth = T/C central de Configuración → Moneda.
function initPosCalculatorTabOnce(){
  if (__A33_POS_CALC_INIT) return;
  __A33_POS_CALC_INIT = true;

  const els = {
    hist: document.getElementById('calc-history'),
    out: document.getElementById('calc-output'),
    keys: document.getElementById('calc-keys'),
    fxRate: document.getElementById('fx-rate'),
    fxUsd: document.getElementById('fx-usd'),
    fxNio: document.getElementById('fx-nio'),
    fxMeta: document.getElementById('fx-meta'),
    fxStatus: document.getElementById('fx-status'),
    fxClear: document.getElementById('fx-clear')
  };

  const calc = {
    acc: null,
    op: null,
    lastOp: null,
    lastOperand: null,
    newEntry: true,
    display: '0'
  };

  const fx = {
    lock: false,
    lastEdited: 'usd'
  };

  function setHistory(txt){ if (els.hist) els.hist.textContent = txt || ''; }
  function setOutput(txt){ if (els.out) els.out.textContent = (txt == null ? '0' : String(txt)); }

  function setDisplay(txt){
    calc.display = String(txt == null ? '0' : txt);
    setOutput(calc.display);
  }

  function getDisplayNumber(){
    const n = Number(calc.display);
    return Number.isFinite(n) ? n : 0;
  }

  function applyOp(a, b, op){
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return (b === 0) ? NaN : (a / b);
    return b;
  }

  function formatResult(n){
    if (!Number.isFinite(n)) return 'Error';
    // Reduce ruido típico de floats sin ponernos poetas.
    const rounded = Math.round(n * 1e12) / 1e12;
    let s = String(rounded);
    if (!s.includes('e')) s = posCalcTrimDec(s);
    return s;
  }

  function pressDigit(d){
    const ch = String(d);
    if (calc.newEntry){
      setDisplay(ch === '.' ? '0.' : ch);
      calc.newEntry = false;
      return;
    }
    if (ch === '.' && calc.display.includes('.')) return;
    if (calc.display === '0' && ch !== '.') setDisplay(ch);
    else setDisplay(calc.display + ch);
  }

  function clearAll(){
    calc.acc = null;
    calc.op = null;
    calc.lastOp = null;
    calc.lastOperand = null;
    calc.newEntry = true;
    setHistory('');
    setDisplay('0');
  }

  function backspace(){
    if (calc.newEntry) return;
    if (calc.display.length <= 1) { setDisplay('0'); calc.newEntry = true; return; }
    setDisplay(calc.display.slice(0, -1));
  }

  function setOp(op){
    // Si el usuario está cambiando de operador sin ingresar el segundo número.
    if (calc.op && calc.newEntry){
      calc.op = op;
      setHistory(posCalcTrimDec(calc.acc) + ' ' + op);
      return;
    }

    const b = getDisplayNumber();
    if (calc.acc == null){
      calc.acc = b;
    } else if (calc.op){
      const r = applyOp(calc.acc, b, calc.op);
      calc.acc = r;
      setDisplay(formatResult(r));
    }
    calc.op = op;
    calc.newEntry = true;
    calc.lastOp = null;
    calc.lastOperand = null;
    setHistory(formatResult(calc.acc) + ' ' + op);
  }

  function equals(){
    let b = getDisplayNumber();
    let op = calc.op;

    // Repetir "=" usa el último operando (comportamiento clásico)
    if (!op && calc.lastOp){
      op = calc.lastOp;
      b = calc.lastOperand;
    }

    if (!op) return;
    if (calc.acc == null) calc.acc = 0;
    const r = applyOp(calc.acc, b, op);
    calc.lastOp = op;
    calc.lastOperand = b;
    calc.op = null;
    calc.acc = r;
    calc.newEntry = true;
    setHistory('');
    setDisplay(formatResult(r));
  }

  function ensureRate(){
    const rate = posCalcReadNum(els.fxRate);
    if (!rate || !(rate > 0)) return null;
    return rate;
  }

  function fxShowStatus(msg){
    if (!els.fxStatus) return;
    if (msg){
      els.fxStatus.style.display = 'block';
      els.fxStatus.textContent = msg;
    } else {
      els.fxStatus.style.display = 'none';
      els.fxStatus.textContent = '';
    }
  }

  function fxUpdateFromUSD(){
    if (fx.lock) return;
    fx.lastEdited = 'usd';
    const rate = ensureRate();
    const usd = posCalcReadNum(els.fxUsd);
    fx.lock = true;
    try{
      if (!rate){
        if (els.fxNio) els.fxNio.value = '';
        fxShowStatus(POS_CURRENCY_TC_REQUIRED_MSG);
      } else {
        fxShowStatus('');
        if (els.fxNio) els.fxNio.value = (usd == null) ? '' : posCalcFmt2(usd * rate);
      }
    } finally {
      fx.lock = false;
    }
  }

  function fxUpdateFromNIO(){
    if (fx.lock) return;
    fx.lastEdited = 'nio';
    const rate = ensureRate();
    const nio = posCalcReadNum(els.fxNio);
    fx.lock = true;
    try{
      if (!rate){
        if (els.fxUsd) els.fxUsd.value = '';
        fxShowStatus(POS_CURRENCY_TC_REQUIRED_MSG);
      } else {
        fxShowStatus('');
        if (els.fxUsd) els.fxUsd.value = (nio == null) ? '' : posCalcFmt2(nio / rate);
      }
    } finally {
      fx.lock = false;
    }
  }

  function fxRecompute(){
    if (fx.lastEdited === 'nio') fxUpdateFromNIO();
    else fxUpdateFromUSD();
  }

  // Bind teclado calculadora (delegación)
  if (els.keys){
    els.keys.addEventListener('click', (e)=>{
      const b = e.target.closest('button');
      if (!b) return;
      const k = b.dataset.k;
      if (!k) return;

      if (/^\d$/.test(k)) return pressDigit(k);
      if (k === '.') return pressDigit('.');
      if (k === 'C') return clearAll();
      if (k === 'back') return backspace();
      if (k === '=') return equals();
      if (k === '+' || k === '-' || k === '*' || k === '/') return setOp(k);
    });
  }



  async function fxPersistRate(){
    try{
      if (!els.fxRate) return false;
      const central = posCurrencyRequireCentralExchangeRatePOS();
      try{ els.fxRate.value = central.fixed || ''; }catch(_){ }
      try{ els.fxRate.disabled = true; els.fxRate.readOnly = true; }catch(_){ }
      try{ toggleInvalidBorderPOS(els.fxRate, !central.ok); }catch(_){ }
      try{ await syncExchangeRateInputs(); }catch(_){ }
      try{ fxRecompute(); }catch(_){ }
      fxShowStatus(central.msg);
      return !!central.ok;
    }catch(err){
      console.error('[A33][POS][FX][CALC] No se pudo leer T/C central', err);
      fxShowStatus(POS_CURRENCY_TC_REQUIRED_MSG);
      try{ toggleInvalidBorderPOS(els.fxRate, true); }catch(_){ }
      return false;
    }
  }

  // Bind conversor FX
  if (els.fxUsd) els.fxUsd.addEventListener('input', fxUpdateFromUSD);
  if (els.fxNio) els.fxNio.addEventListener('input', fxUpdateFromNIO);
  if (els.fxRate){
    els.fxRate.addEventListener('input', ()=>{
      const central = posCurrencyRequireCentralExchangeRatePOS();
      try{ els.fxRate.value = central.fixed || ''; }catch(_){ }
      try{ toggleInvalidBorderPOS(els.fxRate, !central.ok); }catch(_){ }
      fxShowStatus(central.msg);
      fxRecompute();
    });
    els.fxRate.addEventListener('change', ()=>{ fxPersistRate().catch(err=>console.error('[A33][POS][FX][CALC] change save', err)); });
    els.fxRate.addEventListener('blur', ()=>{ fxPersistRate().catch(err=>console.error('[A33][POS][FX][CALC] blur save', err)); });
    els.fxRate.addEventListener('keydown', (ev)=>{
      if (ev && ev.key === 'Enter'){
        try{ ev.preventDefault(); }catch(_){ }
        try{ els.fxRate.blur(); }catch(_){ }
      }
    });
  }
  if (els.fxClear) els.fxClear.addEventListener('click', ()=>{
    if (els.fxUsd) els.fxUsd.value = '';
    if (els.fxNio) els.fxNio.value = '';
    fxShowStatus('');
  });

  document.querySelectorAll('.fx-q').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const usd = Number(btn.dataset.usd || 0);
      if (els.fxUsd) els.fxUsd.value = (usd && usd > 0) ? String(usd) : '';
      fxUpdateFromUSD();
    });
  });

  // Render inicial
  clearAll();
  fxShowStatus('');
}

async function onOpenPosCalculatorTab(){
  initPosCalculatorTabOnce();

  const rateEl = document.getElementById('fx-rate');
  const metaEl = document.getElementById('fx-meta');
  const statusEl = document.getElementById('fx-status');
  if (!rateEl || !metaEl || !statusEl) return;

  let ev = null;
  let fixed = '';
  try{ ev = await getCurrentEventForExchangeRatePOS(); }catch(_){ ev = null; }
  try{ fixed = posCurrencyCentralExchangeRateFixedPOS(); }catch(_){ fixed = ''; }

  try{ rateEl.disabled = true; }catch(_){ }
  try{ rateEl.readOnly = true; }catch(_){ }
  try{ rateEl.value = fixed; }catch(_){ }
  try{ rateEl.title = 'T/C central desde Configuración → Moneda'; }catch(_){ }
  try{ toggleInvalidBorderPOS(rateEl, !fixed); }catch(_){ }

  if (!ev){
    metaEl.textContent = 'Sin evento activo · T/C desde Moneda';
    statusEl.textContent = fixed ? ('Desde Moneda: ' + fixed) : POS_CURRENCY_TC_REQUIRED_MSG;
  } else if (ev.closedAt){
    metaEl.textContent = `Evento cerrado: ${ev.name || 'Sin nombre'} · T/C desde Moneda`;
    statusEl.textContent = fixed ? ('Desde Moneda: ' + fixed) : POS_CURRENCY_TC_REQUIRED_MSG;
  } else {
    metaEl.textContent = `Evento activo: ${ev.name || 'Sin nombre'} · T/C desde Moneda`;
    statusEl.textContent = fixed ? ('Desde Moneda: ' + fixed) : POS_CURRENCY_TC_REQUIRED_MSG;
  }
  statusEl.style.display = 'block';

  // Recalcular si hay montos escritos.
  try{
    const usdEl = document.getElementById('fx-usd');
    const nioEl = document.getElementById('fx-nio');
    const usd = usdEl ? String(usdEl.value||'').trim() : '';
    const nio = nioEl ? String(nioEl.value||'').trim() : '';
    if (nio && !usd && nioEl) nioEl.dispatchEvent(new Event('input', { bubbles:true }));
    else if (usdEl) usdEl.dispatchEvent(new Event('input', { bubbles:true }));
  }catch(e){ /* no-op */ }
}



document.addEventListener('DOMContentLoaded', init);