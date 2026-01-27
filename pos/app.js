// --- IndexedDB helpers POS
const DB_NAME = 'a33-pos';
const DB_VER = 31; // Etapa 1/5 (Efectivo v2 Histórico): nuevos stores aislados + llaves canónicas + versionado
let db;

// --- Build / version (fuente unica de verdad)
const POS_BUILD = (typeof window !== 'undefined' && window.A33_VERSION) ? String(window.A33_VERSION) : '4.20.70';


const POS_SW_CACHE = (typeof window !== 'undefined' && window.A33_POS_CACHE_NAME) ? String(window.A33_POS_CACHE_NAME) : ('a33-v' + POS_BUILD + '-pos-r36');

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

  const rec = {
    version: 2,
    key: cashV2Key(eid, todayKey),
    eventId: eid,
    dayKey: todayKey,
    openTs,
    status: 'OPEN',
    closeTs: null,
    fx: null,
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

  const cashDay = {
    version: 2,
    key,
    eventId: eid,
    dayKey: dk,
    openTs,
    status: 'OPEN',
    closeTs: null,
    fx: null,
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

  // Ventas en efectivo C$ (solo NIO)
  let cashSalesC = 0;
  try{
    if (rec.cashSalesC != null && Number.isFinite(Number(rec.cashSalesC))) cashSalesC = cashV2Round2Money(rec.cashSalesC);
    else cashSalesC = cashV2Round2Money(cashV2GetCashSalesC());
  }catch(_){ cashSalesC = 0; }
  if (!Number.isFinite(Number(cashSalesC))) cashSalesC = 0;

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
    }
  }catch(_){ }
  CASHV2_LAST_REC = rec || null;
}
function cashV2GetLastRec(){ return CASHV2_LAST_REC; }

function cashV2DefaultInitial(){
  const mk = (arr)=>{ const o = {}; (arr||[]).forEach(d=>{ o[String(d)] = 0; }); return o; };
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

// Helper pedido (Etapa 4/5): normaliza denomCounts, garantiza claves y sanea valores.
function normalizeDenomCounts(currency, counts){
  const ccy = String(currency || '').trim().toUpperCase();
  const denoms = CASHV2_DENOMS[ccy] || [];
  const src = (counts && typeof counts === 'object') ? counts : {};
  const out = {};
  for (const d of denoms){
    const k = String(d);
    const raw = (src[k] != null) ? src[k] : ((src[d] != null) ? src[d] : 0);
    out[k] = cashV2NormCount(raw);
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
  const n = Number(raw);
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

// Normaliza lo que entra al record v2 (persistencia)
function cashV2CoerceFx(v){
  const n = cashV2FxNorm(v);
  return (n == null) ? null : n;
}

function cashV2SetFxEnabled(en){
  const card = document.getElementById('cashv2-fx-card');
  if (!card) return;
  const ok = !!en;
  try{ const inp = document.getElementById('cashv2-fx-input'); if (inp) inp.disabled = !ok; }catch(_){ }
  try{ const btn = document.getElementById('cashv2-btn-save-fx'); if (btn) btn.disabled = !ok; }catch(_){ }
}

function cashV2ApplyFxToDom(rec, eventId){
  const inp = document.getElementById('cashv2-fx-input');
  const st = document.getElementById('cashv2-fx-save-status');
  const err = document.getElementById('cashv2-fx-error');
  const errSm = err ? err.querySelector('small') : null;

  try{ if (err) err.style.display = 'none'; }catch(_){ }
  try{ if (errSm) errSm.textContent = ''; }catch(_){ }

  if (!inp) return;

  let rate = cashV2FxNorm(rec && rec.fx);

  // fallback: cache por evento (nuevo, no legacy)
  if (rate == null && eventId){
    try{ rate = cashV2FxGetCached(eventId); }catch(_){ rate = null; }
  }

  const fixed = (rate != null) ? cashV2FxFmt2(rate) : '';
  try{ inp.value = fixed; }catch(_){ }
  try{ if (st) st.textContent = fixed ? `Actual: ${fixed}` : '—'; }catch(_){ }
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

  inp.addEventListener('input', ()=>{
    const n = cashV2FxNorm(inp.value);
    try{ if (st) st.textContent = n != null ? `Actual: ${cashV2FxFmt2(n)}` : '—'; }catch(_){ }
  });

  inp.addEventListener('blur', ()=>{
    const n = cashV2FxNorm(inp.value);
    if (n != null){
      try{ inp.value = cashV2FxFmt2(n); }catch(_){ }
    }
  });

  btn.addEventListener('click', async ()=>{
    if (btn.disabled) return;
    showErr('');

    const eid = String(card.dataset.eventId || '').trim();
    const dk = String(card.dataset.dayKey || '').trim();
    const ro = String(card.dataset.readonly || '') === '1';
    if (!eid || !dk) return;
    if (ro){
      try{ toast('Bloqueado: no editable'); }catch(_){ }
      return;
    }

    const n = cashV2FxNorm(inp.value);
    if (n == null){
      showErr('Ingresa un tipo de cambio válido (> 0).');
      try{ toast('Tipo de cambio inválido'); }catch(_){ }
      return;
    }

    const fixed = cashV2FxFmt2(n);
    try{ inp.value = fixed; }catch(_){ }

    try{
      const rec = await cashV2Ensure(eid, dk);
      rec.fx = cashV2CoerceFx(n);
      const saved = await cashV2Save(rec);

      try{ cashV2SetLastRec(saved); }catch(_){ }
      cashV2FxSetCached(eid, n);

      // write-through: also save FX where Calculadora reads its rate (single source of truth)
      try{
        const fx2 = String(fixed || '').trim();
        posCalcSafeLSSet(A33_POS_CALC_FX_LS_KEY, fx2);
      }catch(_){ }

      try{ if (st) st.textContent = `Guardado: ${fixed}`; }catch(_){ }
      try{ toast('Tipo de cambio guardado'); }catch(_){ }
    }catch(e){
      console.error('[A33][CASHv2][FX] save error', e);
      showErr('No se pudo guardar.');
      try{ toast('Error al guardar'); }catch(_){ }
    }
  });

  btn.dataset.ready = '1';
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
      return `\n<tr>\n  <td class=\"denom\"><b>${sym} ${k}</b></td>\n  <td>\n    <input type=\"number\" min=\"0\" step=\"1\" inputmode=\"numeric\" pattern=\"[0-9]*\"\n      class=\"cashv2-denom-input\"\n      data-cashv2-initial=\"1\" data-ccy=\"${ccy}\" data-denom=\"${k}\"\n      id=\"cashv2-initial-${ccy}-${k}\" value=\"0\"\n    >\n  </td>\n  <td class=\"sub\"><span id=\"cashv2-sub-${ccy}-${k}\">0</span></td>\n</tr>`;
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
    const n = cashV2NormCount(t.value);
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
        const saved = await cashV2Save(rec);

        const nio = (saved && saved.initial && saved.initial.NIO && Number(saved.initial.NIO.total)) || 0;
        const usd = (saved && saved.initial && saved.initial.USD && Number(saved.initial.USD.total)) || 0;
        console.log(`[A33][CASHv2] initial save ${eid} ${dk} totals NIO=${nio} USD=${usd}`);

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
    initial[ccy].denomCounts[denom] = cashV2NormCount(inp.value);
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
      if (inp) inp.value = String(cashV2NormCount(v[ccy].denomCounts[k]));
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

// --- POS: Efectivo v2 — “Ventas en efectivo” (C$) desde POS (read-only) por evento/día — Etapa 4/7
let __CASHV2_CASHSALES_C = 0;

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

function cashV2ApplyCashSalesToDom(amount){
  const line = document.getElementById('cashv2-cashsales-line');
  const el = document.getElementById('cashv2-cashsales');
  if (!line || !el) return;

  if (amount == null){
    try{ line.style.display = 'none'; }catch(_){ }
    try{ el.textContent = 'C$ 0.00'; }catch(_){ }
    try{ cashV2SetCashSalesC(0); }catch(_){ }
    return;
  }

  let n = Number(amount);
  if (!Number.isFinite(n)) n = 0;
  try{ el.textContent = 'C$ ' + fmt(n); }catch(_){ el.textContent = 'C$ 0.00'; }
  try{ cashV2SetCashSalesC(n); }catch(_){ }
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

async function cashV2ComputeCashSalesC(eventId, dayKey){
  const eidStr = String(eventId || '').trim();
  if (!eidStr) return 0;
  const dk = safeYMD(dayKey);
  let sum = 0;

  let sales = [];
  try{ sales = await cashV2GetSalesByEventPOS(eidStr); }catch(_){ sales = []; }

  for (const s of (sales || [])){
    if (!s || typeof s !== 'object') continue;
    if (safeYMD(s.date || '') !== dk) continue;
    const pay = String(s.payment || '').toLowerCase();
    if (pay !== 'efectivo' && pay !== 'cash') continue;
    try{ if (typeof isCourtesySalePOS === 'function' && isCourtesySalePOS(s)) continue; }catch(_){ }
    let t = Number(s.total != null ? s.total : 0);
    if (!Number.isFinite(t)) t = 0;
    sum += t;
  }

  // Redondeo 2 dec (ventas pueden venir con centavos)
  sum = Math.round(sum * 100) / 100;
  if (!Number.isFinite(sum)) sum = 0;
  return sum;
}

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
    let sign = ui.sign > 0 ? '+' : (ui.sign < 0 ? '−' : '');
    if (k === 'ADJUST') sign = (amt < 0 ? '−' : '+');
    const amountText = `${sign} ${ccyLabel} ${cashV2FmtInt(Math.abs(amt))}`.trim();

    const desc = (m.desc != null ? String(m.desc) : (m.note != null ? String(m.note) : '')).trim();
    const descHtml = desc ? `<div class="cashv2-move-note" style="white-space:normal; overflow:visible; text-overflow:unset;">${escapeHtml(desc)}</div>` : '';

    return `<div class="cashv2-move-row">
      <div class="cashv2-move-left">
        <div class="cashv2-move-top">
          <span class="cashv2-mtag"><b>${escapeHtml(cashV2FmtDateTime(m.ts))}</b></span>
          <span class="cashv2-mtag">${escapeHtml(ui.text)}</span>
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
    try{ if (selKind) selKind.value = 'IN'; }catch(_){ }
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

    const kind = selKind ? String(selKind.value || '').trim().toUpperCase() : 'IN';
    const ccy = selCcy ? String(selCcy.value || '').trim().toUpperCase() : 'NIO';
    const desc = inpDesc ? String(inpDesc.value || '').trim() : '';
    const ksel = String(selKind ? selKind.value : '').trim().toUpperCase();
    const allowNeg = (ksel === 'ADJUST');
    let amt = cashV2NormAmountInt(inpAmt ? inpAmt.value : 0, { allowNegative: allowNeg });
    if (!Number.isFinite(amt)) amt = 0;
    if (!allowNeg) amt = Math.abs(amt);

    if (!(kind === 'IN' || kind === 'OUT' || kind === 'ADJUST')){
      showErr('Tipo inválido.');
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
        currency: ccy,
        amount: amt,
        desc: desc ? desc.slice(0, 120) : ''
      };

      const next = { ...rec };
      const movs = Array.isArray(next.movements) ? next.movements.slice() : [];
      movs.push(movement);
      next.movements = movs;

      const saved = await cashV2Save(next);
      console.log(`[A33][CASHv2] movement add: ${kind} ${ccy} ${amt}`);

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
      return `\n<tr>\n  <td class=\"denom\"><b>${sym} ${k}</b></td>\n  <td>\n    <input type=\"number\" min=\"0\" step=\"1\" inputmode=\"numeric\" pattern=\"[0-9]*\"\n      class=\"cashv2-denom-input\"\n      data-cashv2-final=\"1\" data-ccy=\"${ccy}\" data-denom=\"${k}\"\n      id=\"cashv2-final-${ccy}-${k}\" value=\"0\"\n    >\n  </td>\n  <td class=\"sub\"><span id=\"cashv2-final-sub-${ccy}-${k}\">0</span></td>\n</tr>`;
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
    const n = cashV2NormCount(t.value);
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
        const saved = await cashV2Save(rec);

        const nums = cashV2ComputeCloseNumbers(saved, { preferDom: false, finalOverride: final });
        const fn = nums.NIO || { final:0, expected:0, diff:0 };
        const fu = nums.USD || { final:0, expected:0, diff:0 };
        console.log(`[A33][CASHv2] final save ${eid} ${dk} totals NIO=${fn.final} USD=${fu.final} expected NIO=${fn.expected} USD=${fu.expected} diff NIO=${fn.diff} USD=${fu.diff}`);

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
    final[ccy].denomCounts[denom] = cashV2NormCount(inp.value);
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
      if (inp) inp.value = String(cashV2NormCount(v[ccy].denomCounts[k]));
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

  const netNio = cashV2Round2Money((sN.in - sN.out) + sN.adjust);
  const netUsd = cashV2Round2Money((sU.in - sU.out) + sU.adjust);

  const eN = cashV2Round2Money(iN + sN.in - sN.out + salesC + sN.adjust);
  const eU = cashV2Round2Money(iU + sU.in - sU.out + sU.adjust);

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
  o.USD.sales = 0;
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
    'cashv2-sum-initial-usd','cashv2-sum-in-usd','cashv2-sum-out-usd','cashv2-sum-adjust-usd','cashv2-sum-expected-usd','cashv2-sum-final-usd'
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

  // Fallback mínimo canónico (sin legacy)
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
  const ventas = (ccy === 'NIO') ? cashV2Round2Money(b.cashSalesC$ || 0) : null;
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
        <tr><td>VentasCashC$</td><td class="sub">${(ventas == null) ? '—' : (escapeHtml(sym) + ' ' + escapeHtml(cashV2FmtMoney(ventas)))}</td></tr>
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
    const topTag = `<span class="cashv2-mtag"><b>${escapeHtml(cashV2HistKindLabel(kind))}</b><span>${escapeHtml(sym)}</span></span>`;
    const note = (m && m.note != null) ? String(m.note).trim() : '';

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
  const uSales = 0; // regla: no inventar ventas USD
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
    try{ cashV2ApplyFxToDom(null, ''); }catch(_){ }
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

  // Etapa 4/7: Ventas en efectivo (C$) — solo lectura (no toca flujo de ventas)
  let cashSalesC = 0;
  try{ cashSalesC = await cashV2ComputeCashSalesC(eventId, dayKey); }catch(_){ cashSalesC = 0; }
  try{ cashV2ApplyCashSalesToDom(cashSalesC); }catch(_){ }

  try{
    let locked = false;
    try{ locked = await isDayLocked(eventId, dayKey); }catch(_){ locked = false; }
    if (locked){
      const lk = `${eventId}|${dayKey}`;
      if (!__CASHV2_LOCK_LOG_ONCE.has(lk)){
        __CASHV2_LOCK_LOG_ONCE.add(lk);
        console.log(`[A33][CASHv2] lock detected ${eventId} ${dayKey}`);
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
      try{ cashV2ApplyFxToDom(null, eventId); }catch(_){ }
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

    try{ if (rec && typeof rec === 'object') rec.cashSalesC = cashSalesC; }catch(_){ }
    try{ cashV2SetLastRec(rec); }catch(_){ }

    // Etapa 3/7: mostrar Tipo de cambio
    try{
      const fx = document.getElementById('cashv2-fx-card');
      if (fx){ fx.style.display = 'block'; fx.dataset.eventId = String(eventId); fx.dataset.dayKey = dayKey; }
    }catch(_){ }
    try{ cashV2ApplyFxToDom(rec, eventId); }catch(_){ }
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
      productId: (sale.productId == null ? null : Number(sale.productId)),
      extraId: (sale.extraId == null ? null : Number(sale.extraId)),
      productName: String(sale.productName || ''),
      qty: Number(sale.qty || 0),
      unitPrice: Number(sale.unitPrice || 0),
      discount: Number(sale.discount || 0),
      discountPerUnit: (sale.discountPerUnit == null ? null : Number(sale.discountPerUnit)),
      total: Number(sale.total || 0),
      payment: String(sale.payment || ''),
      bankId: (sale.bankId == null ? null : Number(sale.bankId)),
      courtesy: !!sale.courtesy,
      isReturn: !!sale.isReturn,
      customerId: (sale.customerId == null ? null : Number(sale.customerId)),
      customerName: String(sale.customerName || sale.customer || ''),
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
        os.createIndex('by_name', 'name', { unique: true });
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
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'id' });
      }
// Catálogo de bancos (para transferencias)
      if (!d.objectStoreNames.contains('banks')) {
        const b = d.createObjectStore('banks', { keyPath: 'id', autoIncrement: true });
        try { b.createIndex('by_name', 'name', { unique: false }); } catch {}
        try { b.createIndex('by_active', 'isActive', { unique: false }); } catch {}
      } else {
        try { e.target.transaction.objectStore('banks').createIndex('by_name', 'name'); } catch {}
        try { e.target.transaction.objectStore('banks').createIndex('by_active', 'isActive'); } catch {}
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

// Mapea forma de pago del POS a cuenta contable
function mapSaleToCuentaCobro(sale) {
  const pay = sale.payment || 'efectivo';
  if (pay === 'efectivo') return '1100';   // Caja
  if (pay === 'transferencia') return '1200'; // Banco
  if (pay === 'credito') return '1300';    // Clientes
  return '1200'; // Otros métodos similares a banco
}

// Crea/actualiza asiento automático en Finanzas por una venta / devolución del POS
async function createJournalEntryForSalePOS(sale) {
  if (!isFinanzasPerSaleEnabled()) { warnFinanzasPerSaleDisabledOnce(); return null; }

  // Crea/actualiza el asiento automático en Finanzas para una venta del POS.
  // Reglas:
  // - Venta normal: ingreso + COGS
  // - Cortesía: SOLO costo (gasto por cortesía), nunca ingreso
  // - Devolución: asiento inverso

  if (!sale) return;

  // Nos aseguramos de tener un ID (origenId) para vincular el asiento
  const saleId = (sale.id != null) ? sale.id : (sale.createdAt != null ? sale.createdAt : null);
  if (saleId == null) {
    console.warn('Venta sin id/createdAt, no se genera asiento automático.');
    return;
  }

  try {
    await ensureFinanzasDB();

    // --- Datos base ---
    const isCourtesy = !!sale.courtesy;
    const isReturn = !!sale.isReturn;
    const amount = round2(Math.abs(Number(sale.total || 0)));

    const qtyAbs = Math.abs(Number(sale.qty || 0)) || 0;

    // Preferimos lineCost si existe (más robusto). Si no, lo calculamos por costo unitario.
    let amountCost = 0;
    const lc = Number(sale.lineCost);
    if (Number.isFinite(lc) && Math.abs(lc) > 0.000001) {
      amountCost = round2(Math.abs(lc));
    } else {
      const unitCostFromSale = (typeof sale.costPerUnit === 'number' && sale.costPerUnit > 0) ? sale.costPerUnit : 0;
      const unitCost = unitCostFromSale > 0 ? unitCostFromSale : getCostoUnitarioProducto(sale.productName);
      amountCost = round2((unitCost > 0 ? unitCost : 0) * qtyAbs);
    }

    // Si no hay nada que registrar, salimos.
    // (Venta sin monto y sin costo no aporta asiento.)
    if (!(amount > 0) && !(amountCost > 0)) return;

    // Selección de cuenta de caja/banco según método de pago
    const payment = (sale.payment || 'efectivo').toString();
    let cashAccount = '1100';
    if (payment === 'transferencia') cashAccount = '1200';
    if (payment === 'credito') cashAccount = '1300';

    // Descripción / tipo
    const prodName = (sale.productName || '').toString();
    const eventName = (sale.eventName || '').toString();
    const courtesyTo = (sale.courtesyTo || '').toString().trim();
    // Etapa 5: referencia de cliente (NO CxC / no afecta montos ni cuentas)
    const customerName = (sale.customerName || '').toString().trim();

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

    // Totales del asiento
    let totalsDebe = 0;
    let totalsHaber = 0;

    if (isCourtesy) {
      totalsDebe = amountCost;
      totalsHaber = amountCost;
    } else {
      totalsDebe = amount + amountCost;
      totalsHaber = amount + amountCost;
    }

    // --- Crear o actualizar el journalEntry (mismo origenId) ---
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

      if (existingEntry) {
        existingEntry.fecha = sale.date;
        existingEntry.date = sale.date;
        existingEntry.descripcion = descripcion;
        existingEntry.tipoMovimiento = tipoMovimiento;
        existingEntry.evento = evento;
        existingEntry.origen = 'POS';
        existingEntry.origenId = saleId;
        existingEntry.totalDebe = totalsDebe;
        existingEntry.totalHaber = totalsHaber;

        const reqPut = storeWrite.put(existingEntry);
        reqPut.onsuccess = () => { entryId = existingEntry.id; };
      } else {
        const entry = {
          fecha: sale.date,
          date: sale.date,
          descripcion,
          tipoMovimiento,
          evento,
          origen: 'POS',
          origenId: saleId,
          totalDebe: totalsDebe,
          totalHaber: totalsHaber
        };
        const reqAdd = storeWrite.add(entry);
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

    // --- Borrar líneas anteriores de este asiento (evita duplicados) ---
    await new Promise((resolve) => {
      const txDel = finDb.transaction(['journalLines'], 'readwrite');
      const storeDel = txDel.objectStore('journalLines');
      const reqLines = storeDel.getAll();
      reqLines.onsuccess = () => {
        const lines = reqLines.result || [];
        lines
          .filter((l) => String(l.entryId) === String(entryId) || String(l.idEntry) === String(entryId))
          .forEach((l) => {
            try { storeDel.delete(l.id); } catch (err) {}
          });
      };
      txDel.oncomplete = () => resolve();
      txDel.onerror = () => resolve();
    });

    // --- Crear nuevas líneas ---
    await new Promise((resolve) => {
      const txLines = finDb.transaction(['journalLines'], 'readwrite');
      const storeLines = txLines.objectStore('journalLines');

      const addLine = (data) => {
        try {
          // Guardamos ambos campos: idEntry (lo que Finanzas espera) y entryId (compatibilidad)
          storeLines.add(Object.assign({ idEntry: entryId, entryId }, data));
        } catch (err) {
          console.error('Error guardando línea contable POS', err);
        }
      };

      if (isCourtesy) {
        // Cortesía: SOLO costo
        //   DEBE: 6105 POS Cortesía
        //   HABER: 1500 Inventario
        if (!isReturn) {
          if (amountCost > 0) {
            addLine({ accountCode: '6105', debe: amountCost, haber: 0 });
            addLine({ accountCode: '1500', debe: 0, haber: amountCost });
          }
        } else {
          // Reverso (por si alguna vez se usa):
          //   DEBE: 1500
          //   HABER: 6105
          if (amountCost > 0) {
            addLine({ accountCode: '1500', debe: amountCost, haber: 0 });
            addLine({ accountCode: '6105', debe: 0, haber: amountCost });
          }
        }

        txLines.oncomplete = () => resolve();
        txLines.onerror = () => resolve();
        return;
      }

      if (!isReturn) {
        // Venta normal:
        // Ingreso:
        //   DEBE: Caja/Banco/Clientes
        //   HABER: 4100 Ingresos
        if (amount > 0) {
          addLine({ accountCode: cashAccount, debe: amount, haber: 0 });
          addLine({ accountCode: '4100', debe: 0, haber: amount });
        }

        // Costo de venta (si hay costo disponible):
        //   DEBE: 5100 Costo de ventas
        //   HABER: 1500 Inventario
        if (amountCost > 0) {
          addLine({ accountCode: '5100', debe: amountCost, haber: 0 });
          addLine({ accountCode: '1500', debe: 0, haber: amountCost });
        }
      } else {
        // Devolución: asiento inverso
        if (amount > 0) {
          addLine({ accountCode: '4100', debe: amount, haber: 0 });
          addLine({ accountCode: cashAccount, debe: 0, haber: amount });
        }

        // Costo inverso:
        if (amountCost > 0) {
          addLine({ accountCode: '1500', debe: amountCost, haber: 0 });
          addLine({ accountCode: '5100', debe: 0, haber: amountCost });
        }
      }

      txLines.oncomplete = () => resolve();
      txLines.onerror = () => resolve();
    });
  } catch (err) {
    console.error('Error general creando/actualizando asiento automático desde POS', err);
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


// --- Ventas: Cliente (Clientes v2: picker propio + pegajoso + gestión)
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

  return {
    id,
    name,
    isActive: !!isActive,
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
  const seenNorm = new Set();
  const out = [];
  let changed = false;

  if (Array.isArray(raw)){
    for (const item of raw){
      const obj = coerceCustomerObjectPOS(item, disabled, existingIds);
      if (!obj) { if (item) changed = true; continue; }

      if (seenNorm.has(obj.normalizedName)){
        // Merge: mantener el primero, pero si alguno está activo, se queda activo.
        const prev = out.find(x => x.normalizedName === obj.normalizedName);
        if (prev && prev.isActive === false && obj.isActive === true) prev.isActive = true;
        changed = true;
        continue;
      }

      seenNorm.add(obj.normalizedName);

      // Si el raw ya era objeto pero faltaba normalizedName/isActive/id, marcamos changed
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
  }catch(_){ }

  // 4) Venta por vaso: inputs (sin tocar data real de vasos del evento)
  try{
    const cq = document.getElementById('cup-qty');
    if (cq) cq.value = '1';
    const cp = document.getElementById('cup-price');
    if (cp) cp.value = '0';
    const fg = document.getElementById('cup-fraction-gallons');
    if (fg) fg.value = '1';
    const cy = document.getElementById('cup-yield');
    if (cy) cy.value = '22';
  }catch(_){ }

  // 5) Búsquedas / filtros temporales
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

  // 6) Cerrar modales/paneles que podrían quedar “colgados”
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

  // 1) Hint de UI: si existe el ID, lo respetamos (y resolvemos merges)
  if (uiHintId){
    const hid = String(uiHintId).trim();
    if (hid && resolver.byId.has(hid)){
      const finalId = resolver.resolveFinalId(hid);
      const displayName = resolver.getDisplayName(finalId) || name;
      return { id: String(finalId), displayName, isNew: false };
    }
  }

  // 2) Match robusto por nombre (name / aliases / nameHistory / clientes fusionados)
  const finalId2 = resolver.matchNameToFinalId(name);
  if (finalId2){
    const displayName = resolver.getDisplayName(finalId2) || name;
    return { id: String(finalId2), displayName, isNew: false };
  }

  // 3) Nuevo (se agregará al catálogo al completar la venta)
  const existingIds = new Set(catalog.map(c => c && c.id).filter(Boolean).map(String));
  const newId = generateCustomerIdPOS(existingIds);
  return { id: String(newId), displayName: name, isNew: true };
}

// Venta sin cliente (Etapa 1): confirmación antes de registrar
function isNoCustomerSelectedForSalePOS(){
  const name = getCustomerNameFromUI_POS();
  const hint = getCustomerIdHintFromUI_POS();
  return !name && !hint;
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
  return all.filter(c => c && c.isActive !== false);
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
  // Migración suave: al refrescar UI aseguramos que el catálogo esté en formato objeto
  loadCustomerCatalogPOS();

  // Si el picker está abierto, re-render para respetar desactivados/búsqueda
  if (isCustomerPickerOpenPOS()) renderCustomerPickerListPOS();

  // Si la gestión existe (y esté abierto o no), render listo para cuando se abra
  renderCustomerManageListPOS();
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
  const manageBtn = document.getElementById('btn-toggle-customer-manage');

  if (!inp || !sticky) return;

  setupCustomerPickerModalPOS();
  setupCustomerEditModalPOS();
  setupCustomerMergeModalPOS();
  refreshCustomerUI_POS();

  // Estado pegajoso + último cliente
  const stickyOn = (A33Storage.getItem(CUSTOMER_STICKY_KEY) === '1');
  sticky.checked = stickyOn;
  if (stickyOn){
    const last = A33Storage.getItem(CUSTOMER_LAST_KEY) || '';
    if (last){
      inp.value = sanitizeCustomerDisplayPOS(last);
      // restaurar customerId si existe por match normalizado
      const r = resolveCustomerIdForSalePOS(inp.value, null);
      if (r && r.id && inp.dataset){
        inp.dataset.customerId = String(r.id);
        if (!r.isNew && r.displayName) inp.value = r.displayName;
      }
    }
  }

  sticky.addEventListener('change', ()=>{
    persistCustomerStickyStatePOS();
    if (sticky.checked){
      persistCustomerLastPOS(inp.value || '');
    }
  });

  // Si el usuario teclea, invalidamos el hint de id (se re-resuelve al vender)
  inp.addEventListener('input', ()=>{
    if (inp.dataset) delete inp.dataset.customerId;
    if (isCustomerStickyPOS()) persistCustomerLastPOS(inp.value || '');
  });

  // Si el usuario escribe un alias / nombre viejo / cliente fusionado, lo resolvemos al destino final
  inp.addEventListener('blur', ()=>{
    const raw = sanitizeCustomerDisplayPOS(inp.value || '');
    if (!raw) return;
    const r = resolveCustomerIdForSalePOS(raw, null);
    if (r && r.id && !r.isNew){
      if (inp.dataset) inp.dataset.customerId = String(r.id);
      if (r.displayName) inp.value = r.displayName;
      if (isCustomerStickyPOS()) persistCustomerLastPOS(inp.value || '');
    }
  });

  if (clearBtn){
    clearBtn.addEventListener('click', ()=>{
      clearCustomerSelectionUI_POS();
      persistCustomerLastPOS('');
      inp.focus();
    });
  }

  if (pickBtn){
    pickBtn.addEventListener('click', ()=> openCustomerPickerPOS());
  }

  if (manageBtn){
    manageBtn.addEventListener('click', ()=> toggleCustomerManagePanelPOS());
  }

  // Gestión: agregar cliente sin venta
  const addInp = document.getElementById('customer-add-name');
  const addBtn = document.getElementById('customer-add-save');
  const addMsg = document.getElementById('customer-add-msg');
  if (addBtn && addInp){
    const save = ()=>{
      const name = sanitizeCustomerDisplayPOS(addInp.value || '');
      if (!name){
        if (addMsg) addMsg.textContent = 'Escribe un nombre.';
        addInp.focus();
        return;
      }
      const res = addCustomerToCatalogPOS(name);
      if (!res || !res.ok){
        if (res && res.reason === 'exists'){
          // Si existe pero estaba desactivado, reactivar
          const list2 = loadCustomerCatalogPOS();
          const ex = list2.find(c => c && String(c.id) === String(res.id));
          if (ex && ex.isActive === false && !ex.mergedIntoId){
            setCustomerActiveByIdPOS(ex.id, true);
            if (addMsg) addMsg.textContent = 'Ya existía (reactivado).';
          } else {
            if (addMsg) addMsg.textContent = 'Ya existe.';
          }
          return;
        }
        if (addMsg) addMsg.textContent = 'No se pudo guardar.';
        return;
      }

      addInp.value = '';
      if (addMsg) addMsg.textContent = 'Guardado.';
      renderCustomerManageListPOS();
      if (isCustomerPickerOpenPOS()) renderCustomerPickerListPOS();
      addInp.focus();
    };

    addBtn.addEventListener('click', save);
    addInp.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') save();
    });
  }

  // Gestión: buscador
  const manageSearch = document.getElementById('customer-manage-search');
  if (manageSearch){
    manageSearch.addEventListener('input', ()=> renderCustomerManageListPOS());
  }

  // Gestión: filtros + compacto + expandir/colapsar
  const filterActiveBtn = document.getElementById('customer-manage-filter-active');
  const filterAllBtn = document.getElementById('customer-manage-filter-all');
  const compactChk = document.getElementById('customer-manage-compact');
  const collapseAllBtn = document.getElementById('customer-manage-collapse-all');
  const expandAllBtn = document.getElementById('customer-manage-expand-all');

  if (filterActiveBtn){
    filterActiveBtn.addEventListener('click', ()=>{
      setCustomerManageFilterPOS('active');
      // no forzamos colapsar/expandir; mantenemos preferencia actual
      renderCustomerManageListPOS();
      manageSearch?.focus();
    });
  }
  if (filterAllBtn){
    filterAllBtn.addEventListener('click', ()=>{
      setCustomerManageFilterPOS('all');
      renderCustomerManageListPOS();
      manageSearch?.focus();
    });
  }
  if (compactChk){
    // estado inicial
    compactChk.checked = isCustomerManageCompactPOS();
    compactChk.addEventListener('change', ()=>{
      setCustomerManageCompactPOS(!!compactChk.checked);
      renderCustomerManageListPOS();
    });
  }
  if (collapseAllBtn){
    collapseAllBtn.addEventListener('click', ()=>{
      setAllCustomerManageGroupsPOS(false);
      renderCustomerManageListPOS();
    });
  }
  if (expandAllBtn){
    expandAllBtn.addEventListener('click', ()=>{
      setAllCustomerManageGroupsPOS(true);
      renderCustomerManageListPOS();
    });
  }

  // Estado inicial visual (botones activos / clase compacto)
  applyCustomerManageUIStatePOS();
}

function afterSaleCustomerHousekeepingPOS(customerName, customerId){
  const n = sanitizeCustomerDisplayPOS(customerName);
  if (n){
    // asegurar catálogo con ID (si es nuevo, se crea con el ID ya usado en la venta)
    ensureCustomerInCatalogPOS(n, customerId || null);
    persistCustomerLastPOS(n);
  } else {
    persistCustomerLastPOS('');
  }

  if (!isCustomerStickyPOS()){
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

const CANON_GALON_LABEL = 'Galón 3750 ml';
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
    finished: {
      pulso: { stock: 0 },
      media: { stock: 0 },
      djeba: { stock: 0 },
      litro: { stock: 0 },
      galon: { stock: 0 },
    },
  };
}
function invCentralLoadPOS(){
  try{
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
      const data = A33Storage.sharedGet(STORAGE_KEY_INVENTARIO, invCentralDefaultPOS(), 'local');
      return (data && typeof data === 'object') ? data : invCentralDefaultPOS();
    }
  }catch(e){
    console.warn('Error leyendo inventario central (sharedGet)', e);
  }

  try{
    const raw = A33Storage.getItem(STORAGE_KEY_INVENTARIO);
    let data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== 'object') data = invCentralDefaultPOS();
    if (!data.liquids) data.liquids = {};
    if (!data.bottles) data.bottles = {};
    if (!data.finished) data.finished = {};
    ['pulso','media','djeba','litro','galon'].forEach((id)=>{
      if (!data.finished[id]) data.finished[id] = { stock: 0 };
      const info = data.finished[id];
      if (typeof info.stock !== 'number') info.stock = invParseNumberPOS(info.stock||0);
    });
    return data;
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
function applyFinishedFromSalePOS(sale, direction){
  try{
    const dir = direction === -1 ? -1 : 1;
    const productName = sale.productName || '';
    const finishedId = mapProductNameToFinishedId(productName);
    if (!finishedId) return;
    const q = typeof sale.qty === 'number' ? sale.qty : parseFloat(sale.qty||'0');
    const qty = Number.isNaN(q) ? 0 : q;
    if (!qty) return;
    const delta = -dir * qty; // dir=+1: registrar venta/devolución; dir=-1: revertir
    const inv = invCentralLoadPOS();
    if (!inv.finished) inv.finished = {};
    if (!inv.finished[finishedId]) inv.finished[finishedId] = { stock: 0 };
    inv.finished[finishedId].stock = invParseNumberPOS(inv.finished[finishedId].stock) + delta;
    invCentralSavePOS(inv);
  }catch(e){
    console.error('Error ajustando inventario central desde venta', e);
  }
}
async function renderCentralFinishedPOS(){
  const tbody = document.querySelector('#tbl-inv-central tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const inv = invCentralLoadPOS();
  const defs = [
    { id:'pulso', label:'Pulso 250 ml' },
    { id:'media', label:'Media 375 ml' },
    { id:'djeba', label:'Djeba 750 ml' },
    { id:'litro', label:'Litro 1000 ml' },
    { id:'galon', label:'Galón 3750 ml' },
  ];
  defs.forEach(d=>{
    const info = (inv.finished && inv.finished[d.id]) || { stock: 0 };
    const stock = invParseNumberPOS(info.stock);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.label}</td><td>${stock}</td>`;
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
const SEED = [
  // "Vaso" aquí es una PORCIÓN vendible (Venta por vaso), no un producto del selector.
  {name:'Vaso', price:100, manageStock:false, active:true, internalType:'cup_portion'},
  {name:'Pulso 250ml', price:120, manageStock:true, active:true},
  {name:'Media 375ml', price:150, manageStock:true, active:true},
  {name:'Djeba 750ml', price:300, manageStock:true, active:true},
  {name:'Litro 1000ml', price:330, manageStock:true, active:true},
  {name:'Galón 3750 ml', price:800, manageStock:true, active:true},
];
const DEFAULT_EVENTS = [{name:'General'}];

async function seedMissingDefaults(force=false){
  const list = await getAll('products');
  const keys = new Set(list.map(p=>normKeyPOS(p.name)));

  // Alias legacy: si existe Galón 3800 (o variantes), lo tratamos como galón canónico para no duplicar.
  if (keys.has(normKeyPOS('Galón 3800ml')) || keys.has(normKeyPOS('Galón 3800 ml'))){
    keys.add(normKeyPOS(CANON_GALON_LABEL));
  }

  for (const s of SEED){
    const k = normKeyPOS(s.name);
    const existing = list.find(p=>normKeyPOS(p.name)===k);

    if (force || !existing){
      if (existing){
        existing.active = true;
        if (!existing.price || existing.price <= 0) existing.price = s.price;
        // Ajuste suave: si era el default viejo del galón (900), lo alineamos a 800.
        if (k === normKeyPOS(CANON_GALON_LABEL) && Number(existing.price) === 900) existing.price = 800;
        if (typeof existing.manageStock === 'undefined') existing.manageStock = s.manageStock;
        if (s.internalType) existing.internalType = s.internalType;
        await put('products', existing);
      } else {
        await put('products', {...s});
      }
    } else {
      // Existe: solo completar faltantes (sin pisar custom)
      let changed = false;
      if (typeof existing.active === 'undefined'){ existing.active = true; changed = true; }
      if (typeof existing.manageStock === 'undefined'){ existing.manageStock = s.manageStock; changed = true; }
      if (!(Number(existing.price) > 0)) { existing.price = s.price; changed = true; }
      if (k === normKeyPOS(CANON_GALON_LABEL) && Number(existing.price) === 900) { existing.price = 800; changed = true; }
      if (changed) await put('products', existing);
    }
  }
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
  const name = String(sale.productName || '').trim();
  if (!name) return { ok:false, msg:'Venta inválida: nombre de producto vacío.' };

  // Validaciones duras (anti-NaN/negativos donde no aplica) antes de persistir
  const unitPrice = Number(sale.unitPrice);
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


  const pid = Number(sale.productId);
  const isExtra = !!sale.isExtra;
  if (isExtra){
    const ex = Number(sale.extraId);
    if (!(Number.isFinite(ex) && ex > 0)) return { ok:false, msg:'Venta inválida: extra inválido.' };
  } else {
    if (!(Number.isFinite(pid) && pid > 0)) return { ok:false, msg:'Venta inválida: producto inválido.' };
  }

  const pay = String(sale.payment || '');
  if (pay === 'transferencia'){
    const bid = Number(sale.bankId);
    if (!(Number.isFinite(bid) && bid > 0)) return { ok:false, msg:'Venta inválida: falta banco de transferencia.' };
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

async function guardLotAvailabilityBeforeSalePOS(eventId, productName, qty){
  const presKey = presKeyFromProductNamePOS(productName);
  if (!presKey) return { ok:true, presKey:'' };

  try{
    const fifo = await computeLotFifoForEvent(eventId);
    const v = validateLotFifoIntegrityPOS(fifo, eventId);
    if (!v.ok) return { ok:false, presKey, msg: v.msg };

    const totals = lotTotalsForKeyPOS(fifo, presKey);

    // A) Sin lotes asignados / disponibles
    if (!(totals.loaded > 0) || !(totals.remaining > 0)){
      return { ok:false, presKey, msg:'No hay lotes asignados a este evento para vender esta presentación.' };
    }

    // B) Excede remaining disponible
    if (Number(qty) > totals.remaining){
      const faltan = Math.max(0, Number(qty) - totals.remaining);
      return { ok:true, presKey, warn:true, remaining: totals.remaining, faltan };
    }

    return { ok:true, presKey, warn:false, remaining: totals.remaining, faltan:0 };
  }catch(e){
    console.warn('guardLotAvailabilityBeforeSalePOS failed', e);
    return { ok:false, presKey, msg:'No se pudo verificar lotes/FIFO para esta venta. Revisa tus lotes asignados e intenta de nuevo.' };
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
  const lc = Number(s && s.lineCost);
  if (Number.isFinite(lc)) return lc;
  const cpu = Number(s && s.costPerUnit);
  const qty = Number(s && s.qty);
  if (Number.isFinite(cpu) && Number.isFinite(qty)) return cpu * qty;
  return 0;
}

async function computeDailySnapshotFromSalesPOS(eventId, dateKey){
  const dk = safeYMD(dateKey);
  const sales = await getAll('sales');
  const filtered = sales.filter(s => s && Number(s.eventId) === Number(eventId) && String(s.date || '') === dk);

  const byPay = {};
  let grand = 0;
  let courtesyQty = 0;

  // Costos (COGS): solo para Arcano 33 (presentaciones) + Vaso (fraccionamiento).
  let paidCost = 0;
  let courtesyCost = 0;

  const breakdownMap = new Map();

  const baseName = (name) => {
    const bn = String(name || '')
      .replace(/\s*\(Cortes[ií]a\)\s*$/i, '')
      .trim();
    return uiProductNamePOS(bn);
  };

  const isA33CostableSale = (s) => {
    if (!s) return false;
    if (s.vaso === true) return true;
    const bn = baseName(s.productName || s.name || '');
    return !!mapProductNameToPresId(bn);
  };

  const addBreakdown = (s, isCourtesy, lineCost) => {
    const qty = Number(s.qty || 0);
    const nm = baseName(s.productName || s.name || '');
    const key = nm || String(s.productId || 'unknown');
    if (!key) return;

    if (!breakdownMap.has(key)) {
      breakdownMap.set(key, {
        productId: (s.productId != null) ? s.productId : null,
        productName: nm || String(s.productName || ''),
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

    // UnitCost (auditoría): preferimos costPerUnit guardado en la venta.
    let unitCost = Number(s.costPerUnit || 0);
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

    // Cortesías: no generan ingresos, pero sí consumen costo.
    if (courtesy){
      courtesyQty += Math.abs(qty || 0);
    } else {
      const pay = String(s.payment || 'otros');
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

  return {
    dayKey: dk,
    ventasPorMetodo: byPay,
    totalGeneral: grand,
    cortesiaCantidad: courtesyQty,
    // Compat legacy
    cortesiaCostoTotal: costoCortesiasTotal,
    // Nuevo esquema de costos
    costoVentasTotal,
    costoCortesiasTotal,
    costoTotalSalidaInventario,
    costBreakdown,
    counts: { totalSales: filtered.length }
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
      cortesiaCantidad: snapshot.cortesiaCantidad,
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
    'btn-add','btn-add-sticky','btn-undo',
    'btn-fraction','cup-fraction-gallons','cup-yield','cup-qty','cup-qty-minus','cup-qty-plus','cup-price','btn-sell-cups','btn-courtesy-cups'
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

  // Bloque Venta por vaso
  const cupBlock = document.getElementById('cup-block');
  if (cupBlock){
    cupBlock.classList.toggle('disabled', !!disabled);
    cupBlock.querySelectorAll('input, button, select, textarea').forEach(el=>{
      el.disabled = !!disabled;
    });
  }
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

  // Refrescar cup-block labels/stock sin romper nada
  try{ await refreshCupBlock(); }catch(e){}
}

// Normalizar producto Galón (legacy 3800ml -> 3750ml)
async function normalizeLegacyGallonProductPOS(){
  try{
    const products = await getAll('products');
    if (!Array.isArray(products) || !products.length) return;

    const canonicalName = CANON_GALON_LABEL;

    // Identificar productos tipo "galón" con la misma heurística usada por inventario.
    const galonProducts = products.filter(p => p && mapProductNameToFinishedId(p.name || '') === 'galon');
    if (!galonProducts.length) return;

    const canonicalKey = normKeyPOS(canonicalName);

    // Elegir canon: preferir ya-3750, luego cualquiera.
    let canon = galonProducts.find(p => normKeyPOS(p.name) === canonicalKey)
      || galonProducts.find(p => normName(p.name).includes('3750'))
      || galonProducts[0];

    // Canon: label estándar + precio solo si faltaba/0 o si venía con el default viejo 900.
    let changedCanon = false;
    if (canon.name !== canonicalName){ canon.name = canonicalName; changedCanon = true; }
    const pr = Number(canon.price || 0);
    if (!(pr > 0) || pr === 900){ canon.price = 800; changedCanon = true; }
    if (typeof canon.manageStock === 'undefined'){ canon.manageStock = true; changedCanon = true; }
    if (typeof canon.active === 'undefined'){ canon.active = true; changedCanon = true; }
    if (changedCanon) await put('products', canon);

    // Duplicados: mantener data (sin borrar) pero evitar duplicación en UI/ventas.
    for (const p of galonProducts){
      if (!p || p.id === canon.id) continue;
      let ch = false;
      // Display consistente: no dejar “3800” visible.
      if (p.name !== canonicalName){ p.name = canonicalName; ch = true; }
      // Completar precio solo si faltaba/0 (no pisar custom)
      const ppr = Number(p.price || 0);
      if (!(ppr > 0)){ p.price = 800; ch = true; }
      // Ocultar de catálogo de venta
      if (p.active !== false){ p.active = false; ch = true; }
      if (typeof p.manageStock === 'undefined'){ p.manageStock = true; ch = true; }
      if (ch) await put('products', p);
    }
  }catch(e){
    console.warn('No se pudo normalizar producto Galón', e);
  }
}


// Ensure defaults
async function ensureDefaults(){
  let products = await getAll('products');
  // Migración suave: renombrar Galón 3750 ml -> Galón 3750 ml (sin migraciones destructivas)
  await normalizeLegacyGallonProductPOS();
  products = await getAll('products');
  if (!products.length){
    for (const p of SEED) await put('products', p);
  } else {
    for (const p of products){
      let changed = false;
      if (typeof p.active === 'undefined'){ p.active = true; changed = true; }
      if (typeof p.manageStock === 'undefined'){ p.manageStock = true; changed = true; }
      if (changed) await put('products', p);
    }
  }
  products = await getAll('products');
  if (products.length < 5) await seedMissingDefaults(true);
  else await seedMissingDefaults(false);

  const events = await getAll('events');
  if (!events.length){
    for (const ev of DEFAULT_EVENTS) await put('events', {...ev, createdAt:new Date().toISOString()});
  } else {
  }
  const hasKey = (await getAll('meta')).some(m=>m.id==='currentEventId');
  if (!hasKey){
    const evs = await getAll('events');
    if (evs.length) await setMeta('currentEventId', evs[0].id);
  }

  // Bancos (catálogo para transferencias)
  await ensureBanksDefaults();
}

// --- Bancos (transferencias)
// Seed base para catálogo de bancos (se pre-carga solo si el store está vacío)
// Nota: mantener nombres en mayúsculas para consistencia visual y de reportes.
const BANKS_SEED = ['BAC', 'BANPRO', 'LAFISE', 'BDF'];

function normBankName(name){
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
        await put('banks', { name, isActive: true, createdAt: now });
      }
      banks = await getAllBanksSafe();
    }

    // Migración suave de campos + normalización mínima (sin romper historial)
    for (const b of banks){
      if (!b) continue;
      let changed = false;
      if (typeof b.isActive === 'undefined'){ b.isActive = true; changed = true; }
      if (!b.createdAt){ b.createdAt = new Date().toISOString(); changed = true; }
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
  if (!sale || (sale.payment || '') !== 'transferencia') return '';
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

  const payment = document.getElementById('sale-payment')?.value || 'efectivo';
  if (payment !== 'transferencia'){
    row.style.display = 'none';
    sel.value = '';
    if (note) note.textContent = '';
    return;
  }

  row.style.display = 'block';
  const banks = (await getAllBanksSafe()).filter(b => b && b.isActive !== false);
  banks.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||''), 'es-NI', { sensitivity:'base' }));

  // Mantener selección si aún existe
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
  if (prev) sel.value = prev;

  if (!banks.length){
    if (note) note.textContent = 'No hay bancos activos. Agregá uno en Productos.';
  } else {
    if (note) note.textContent = '';
  }
}

async function renderBancos(){
  const wrap = document.getElementById('banks-list');
  if (!wrap) return;
  const banks = await getAllBanksSafe();
  if (!banks.length){
    wrap.innerHTML = '<div class="warn">No hay bancos. Agrega al menos uno para usar Transferencias.</div>';
    return;
  }
  const rows = banks.slice().sort((a,b)=>{
    const aa = (a && a.isActive !== false) ? 0 : 1;
    const bb = (b && b.isActive !== false) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return String(a.name||'').localeCompare(String(b.name||''), 'es-NI', { sensitivity:'base' });
  });

  let html = '<table class="table small"><thead><tr><th>Banco</th><th>Estado</th><th></th></tr></thead><tbody>';
  for (const b of rows){
    const active = b && b.isActive !== false;
    const estado = active ? 'Activo' : 'Inactivo';
    const btnTxt = active ? 'Desactivar' : 'Activar';
    const btnClass = active ? 'btn-warn' : 'btn-ok';
    html += `<tr>
      <td>${escapeHtml(b.name||'')}</td>
      <td>${estado}</td>
      <td><button class="${btnClass} btn-mini btn-toggle-bank" data-id="${b.id}">${btnTxt}</button></td>
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
async function renderProductos(){
  const list = await getAll('products');
  const wrap = $('#productos-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!list.length){
    const p = document.createElement('div'); p.className = 'warn'; p.textContent = 'No hay productos. Agrega los de Arcano 33 abajo.'; wrap.appendChild(p);
  }
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'card';
    row.innerHTML = `
      <div class="row">
        <input data-id="${p.id}" class="p-name" value="${p.name}">
        <div class="row">
          <input data-id="${p.id}" class="p-price a33-num" data-a33-default="${p.price}" type="number" inputmode="decimal" step="0.01" value="${p.price}">
          <label class="flag"><input type="checkbox" class="p-active" data-id="${p.id}" ${p.active===false?'':'checked'}> Activo</label>
          <label class="flag"><input type="checkbox" class="p-manage" data-id="${p.id}" ${p.manageStock===false?'':'checked'}> Inventario</label>
          <button data-id="${p.id}" class="btn-danger btn-del">Eliminar</button>
        </div>
      </div>
    `;
    wrap.appendChild(row);
  }
  await renderProductChips();

  // Bancos (gestión en pestaña Productos)
  await renderBancos();
}

// Productos internos/virtuales del POS que NO deben aparecer en selector ni inventario.
// Nota: "Vaso" aquí representa porciones de sangría (Venta por vaso), no un producto vendible del selector.
async function getHiddenProductIdsPOS(){
  const hidden = new Set();
  try{
    const vaso = await getVasoProductPOS();
    if (vaso && vaso.id != null) hidden.add(vaso.id);
  }catch(e){}
  return hidden;
}

// Chips de productos (todos los activos)
async function renderProductChips(){
  const chips = $('#product-chips'); if (!chips) return;
  chips.innerHTML='';

  const hiddenIds = await getHiddenProductIdsPOS();
  let list = (await getAll('products')).filter(p=>p.active!==false && !hiddenIds.has(p.id));

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
    c.dataset.id = p.id;
    if (!enabled) c.classList.add('disabled');
    c.textContent = p.name;
    if (selected && selected.kind==='product' && p.id === selected.id) c.classList.add('active');

    c.onclick = async()=>{
      if (!isSellEnabledNowPOS()) return;
      const prev = parseSelectedSellItemValue(sel.value);
      sel.value = String(p.id);
      const same = prev && prev.kind==='product' && prev.id === p.id;
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
    warn.textContent = 'No hay productos activos. Activa productos en la pestaña Productos o Inventario.';
    chips.appendChild(warn);
  }
}

// Delegación de eventos para Productos
document.addEventListener('change', async (e)=>{
  if (e.target.classList.contains('p-name') || e.target.classList.contains('p-price') || e.target.classList.contains('p-manage') || e.target.classList.contains('p-active')){
    const id = parseInt(e.target.dataset.id||'0',10);
    if (!id) return;
    const all = await getAll('products');
    const cur = all.find(px=>px.id===id); if (!cur) return;
    if (e.target.classList.contains('p-name')) cur.name = e.target.value.trim();
    if (e.target.classList.contains('p-price')) cur.price = parseFloat(e.target.value||'0');
    if (e.target.classList.contains('p-manage')) cur.manageStock = e.target.checked;
    if (e.target.classList.contains('p-active')) cur.active = e.target.checked;
    try{
      await put('products', cur);
      await renderProductos(); 
      await refreshProductSelect(); 
      await renderInventario();
      toast('Producto actualizado');
    }catch(err){
      alert('No se pudo guardar el producto. ¿Nombre duplicado?');
    }
  }
});
document.addEventListener('click', async (e)=>{
  const delBtn = e.target.closest('.btn-del');
  if (delBtn){
    const id = parseInt(delBtn.dataset.id,10);
    if (!confirm('¿Eliminar este producto? Esto no borra ventas pasadas.')) return;
    await del('products', id);
    await renderProductos(); await refreshProductSelect(); await renderInventario();
    toast('Producto eliminado');
  }
});

// Delegación de eventos para Bancos
document.addEventListener('click', async (e)=>{
  const tBtn = e.target.closest('.btn-toggle-bank');
  if (!tBtn) return;
  const id = parseInt(tBtn.dataset.id || '0', 10);
  if (!id) return;

  const banks = await getAllBanksSafe();
  const b = banks.find(x => Number(x.id) === id);
  if (!b) return;
  const currentlyActive = (b.isActive !== false);
  b.isActive = !currentlyActive;
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

  // Evitar doble-disparo touch -> click (iOS Safari/PWA)
  let lastTouchTs = 0;

  const onTap = (e)=>{
    // Solo botones con data-tab dentro de la barra
    const btn = e && e.target ? e.target.closest('button[data-tab]') : null;
    if (!btn || !bar.contains(btn)) return;

    // Ignorar clicks no primarios
    if (e && e.type === 'click' && typeof e.button === 'number' && e.button !== 0) return;

    const dest = String(btn.dataset.tab || '').trim();
    if (!dest) return;

    // Dedup: si viene de touchend, el click siguiente se ignora
    if (e && e.type === 'touchend') lastTouchTs = Date.now();
    if (e && e.type === 'click' && lastTouchTs && (Date.now() - lastTouchTs) < 650) return;

    // Fallback seguro: si no existe el tab destino, no-op limpio
    const target = document.getElementById('tab-' + dest);
    if (!target) return;

    try{ if (e && e.preventDefault) e.preventDefault(); }catch(_){ }
    try{ setTab(dest); }catch(err){ console.error('TABNAV error', err); }
  };

  // Pointer Events cuando existan; fallback a touch/click
  const hasPointer = (typeof window !== 'undefined' && 'PointerEvent' in window);
  if (hasPointer) {
    bar.addEventListener('pointerup', onTap);
  } else {
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
  if (name==='productos') renderProductos();
  if (name==='eventos') renderEventos();
  if (name==='inventario') renderInventario();
  if (name==='efectivo') renderEfectivoTab().catch(err=>console.error(err));
  if (name==='calculadora') onOpenPosCalculatorTab().catch(err=>console.error(err));
  if (name==='checklist') renderChecklistTab().catch(err=>console.error(err));
  if (name==='venta') initVasosPanelPOS().catch(err=>console.error(err));
}

// --- Vasos panel (colapsable persistente)
async function syncVasosPanelKeyPOS(){
  const toggle = document.getElementById('vasosPanelToggle');
  if (!toggle) return 'pos_vasos_panel_open';

  let evId = null;
  try{
    if (window.__A33_SELL_STATE && window.__A33_SELL_STATE.eventId != null){
      evId = parseInt(window.__A33_SELL_STATE.eventId, 10);
    }
  }catch(_){ }

  if (!evId){
    try{
      const cur = await getMeta('currentEventId');
      if (cur != null && cur !== '') evId = parseInt(cur, 10);
    }catch(_){ }
  }

  const key = (evId && Number.isFinite(evId)) ? `pos_vasos_panel_open_${evId}` : 'pos_vasos_panel_open';
  toggle.dataset.storageKey = key;
  return key;
}

function setVasosPanelStatePOS(isOpen, opts){
  const o = (opts || {});
  const save = (o.save !== false);
  const toggle = document.getElementById('vasosPanelToggle');
  const body = document.getElementById('vasosPanelBody');
  if (!toggle || !body) return;

  const open = !!isOpen;
  body.classList.toggle('is-collapsed', !open);
  body.setAttribute('aria-hidden', open ? 'false' : 'true');
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');

  const caret = toggle.querySelector('.vasos-panel-caret');
  if (caret) caret.textContent = open ? '▾' : '▸';
  const stateLbl = toggle.querySelector('.vasos-panel-state');
  if (stateLbl) stateLbl.textContent = open ? 'Ocultar' : 'Mostrar';

  if (save){
    const key = toggle.dataset.storageKey || 'pos_vasos_panel_open';
    try{ localStorage.setItem(key, open ? '1' : '0'); }catch(_){ }
  }
}

async function loadVasosPanelStatePOS(){
  const toggle = document.getElementById('vasosPanelToggle');
  const body = document.getElementById('vasosPanelBody');
  if (!toggle || !body) return;

  const key = await syncVasosPanelKeyPOS();
  let raw = null;
  try{ raw = localStorage.getItem(key); }catch(_){ raw = null; }
  const isOpen = (raw === '1');
  setVasosPanelStatePOS(isOpen, { save:false });
}

function bindVasosPanelOncePOS(){
  // Re-render safe: se enlaza por elemento (no global)
  const toggle = document.getElementById('vasosPanelToggle');
  if (toggle && !toggle.dataset.bound){
    toggle.dataset.bound = '1';
    toggle.addEventListener('click', async ()=>{
      await syncVasosPanelKeyPOS();
      const expanded = (toggle.getAttribute('aria-expanded') === 'true');
      setVasosPanelStatePOS(!expanded, { save:true });
    });
  }

  const closeBtn = document.getElementById('vasosPanelCloseBtn');
  if (closeBtn && !closeBtn.dataset.bound){
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', async ()=>{
      await syncVasosPanelKeyPOS();
      setVasosPanelStatePOS(false, { save:true });
    });
  }
}

async function initVasosPanelPOS(){
  bindVasosPanelOncePOS();
  await loadVasosPanelStatePOS();
}

// --- Deep-link mínimo (Centro de Mando -> POS)
function getTabFromUrlPOS(){
  try{
    const allowed = new Set(['venta','inventario','eventos','efectivo','resumen','productos','calculadora','checklist']);
    // Querystring
    const qs = new URLSearchParams(window.location.search || '');
    const qTab = (qs.get('tab') || '').trim();
    if (qTab){
      const qt = (qTab === 'vender') ? 'venta' : qTab;
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
      const htab = (ht === 'vender') ? 'venta' : ht;
      if (allowed.has(htab)) return htab;
    }
    const hh = (h === 'vender') ? 'venta' : h;
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
  bindChecklistEventsOncePOS();

  // Hardening: asegurar índice posRemindersIndex coherente (se ejecuta 1 vez)
  try{ await maybeRebuildRemindersIndexPOS(); }catch(_e){}

  const empty = document.getElementById('checklist-empty');
  const grid = document.getElementById('checklist-grid');
  const sel = document.getElementById('checklist-event');

  const current = await getMeta('currentEventId');
  const currentId = (current === null || current === undefined || current === '') ? null : parseInt(current, 10);

  if (sel) sel.value = currentId ? String(currentId) : '';

  if (!currentId) {
    if (empty) empty.style.display = 'block';
    if (grid) grid.style.display = 'none';
    return;
  }

  const ev = await getEventByIdPOS(currentId);
  if (!ev) {
    if (empty) empty.style.display = 'block';
    if (grid) grid.style.display = 'none';
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
}

function bindChecklistEventsOncePOS(){
  if (window.__A33_CHECKLIST_BOUND) return;
  window.__A33_CHECKLIST_BOUND = true;

  const sel = document.getElementById('checklist-event');
  if (sel){
    sel.addEventListener('change', async ()=>{
      // Etapa 2: limpiar cliente al cambiar evento
      await resetOperationalStateOnEventSwitchPOS();
      const val = (sel.value || '').trim();
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
    });
  }

  const go = document.getElementById('checklist-go-events');
  if (go){
    go.addEventListener('click', ()=> setTab('eventos'));
  }

  // + Agregar ítem (por sección)
  for (const sec of CHECKLIST_SECTIONS_POS){
    // Soporta tanto IDs fijos (recomendado) como botones por clase/data-section (fallback)
    const btn = document.getElementById(sec.addId) || document.querySelector(`#tab-checklist .chk-add[data-section="${sec.key}"]`);
    if (!btn) continue;
    btn.addEventListener('click', async ()=>{
      const current = await getMeta('currentEventId');
      const currentId = current ? parseInt(current,10) : null;
      if (!currentId){
        try{ showToast('Selecciona un evento primero.'); }catch(e){}
        return;
      }
      const dayKey = safeYMD(getSaleDayKeyPOS());
      const ev = await getEventByIdPOS(currentId);
      if (!ev) return;
      const { template } = ensureChecklistDataPOS(ev, dayKey);
      const id = makeChecklistItemIdPOS();
      template[sec.key] = Array.isArray(template[sec.key]) ? template[sec.key] : [];
      template[sec.key].push({ id, text: 'Nuevo ítem' });
      ev.checklistTemplate = template;
      await put('events', ev);
      await renderChecklistTab();
      const input = document.querySelector(`#${sec.listId} .chk-text[data-id="${CSS.escape(id)}"]`);
      if (input){
        input.focus();
        try{ input.select(); }catch(e){}
      }
    });
  }

  // Delegación de acciones dentro del tab
  const tab = document.getElementById('tab-checklist');
  if (tab){
    tab.addEventListener('click', async (e)=>{
      const remAdd = e.target.closest('#checklist-reminder-add');
      const remDoneToggle = e.target.closest('#checklist-reminder-done-toggle');
      const remClearDone = e.target.closest('#checklist-reminder-clear-done');
      const remDel = e.target.closest('.rem-del');

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

      const up = e.target.closest('.chk-up');
      const down = e.target.closest('.chk-down');
      const del = e.target.closest('.chk-del');
      const reset = e.target.closest('#checklist-reset-day');

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

      if (!(up || down || del)) return;
      const btn = up || down || del;
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

      if (del){
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
    });

    tab.addEventListener('change', async (e)=>{
      const cb = e.target.closest('.chk-box');
      const txt = e.target.closest('.chk-text');
      const remCb = e.target.closest('.rem-toggle');
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
      const { template, state } = ensureChecklistDataPOS(ev, dayKey);

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
        const val = (txt.value || '').trim();
        if (!id || !sectionKey) return;
        const arr = Array.isArray(template[sectionKey]) ? template[sectionKey] : [];
        const it = arr.find(x=>String(x.id)===String(id));
        if (!it) return;
        it.text = val || it.text || 'Ítem';
        template[sectionKey] = arr;
        ev.checklistTemplate = template;
        await put('events', ev);
        return;
      }
    });
  }

  // Recordatorios: Enter = Agregar
  const hookEnter = (el)=>{
    if (!el) return;
    el.addEventListener('keydown', (e)=>{
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const btn = document.getElementById('checklist-reminder-add');
      try{ btn && btn.click(); }catch(_e){}
    });
  };
  hookEnter(document.getElementById('checklist-reminder-text'));
  hookEnter(document.getElementById('checklist-reminder-date'));
  hookEnter(document.getElementById('checklist-reminder-due'));
  hookEnter(document.getElementById('checklist-reminder-priority'));

  // Notas (debounced)
  const notes = document.getElementById('checklist-notes');
  if (notes){
    let t = null;
    notes.addEventListener('input', ()=>{
      clearTimeout(t);
      t = setTimeout(async ()=>{
        const cur = await getMeta('currentEventId');
        const curId = cur ? parseInt(cur,10) : null;
        if (!curId) return;
        const dayKey = safeYMD(getSaleDayKeyPOS());
        const ev = await getEventByIdPOS(curId);
        if (!ev) return;
        const { state } = ensureChecklistDataPOS(ev, dayKey);
        state.notes = notes.value || '';
        ev.days[dayKey].checklistState = state;
        await put('events', ev);
      }, 350);
    });
  }
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
  try{ await refreshProductSelect({ keepSelection:true }); }catch(e){ try{ await renderProductChips(); }catch(_){ } }
  try{ await renderExtrasUI(); }catch(e){}
  try{ await initVasosPanelPOS(); }catch(e){}
}

async function refreshProductSelect(opts){
  opts = opts || {};
  const keepSelection = (opts.keepSelection !== false);

  const hiddenIds = await getHiddenProductIdsPOS();
  const all = await getAll('products');
  const list = all.filter(p => !hiddenIds.has(p.id));

  const sel = $('#sale-product');
  if (!sel) return;

  const prevVal = keepSelection ? String(sel.value || '').trim() : '';
  sel.innerHTML = '';

  // Productos
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (C${fmt(p.price)})${p.active===false?' [inactivo]':''}`;
    sel.appendChild(opt);
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

  const prodId = item.id;
  const products = await getAll('products');
  const p = products.find(pp=>pp.id===prodId);
  if (!p || p.manageStock===false) { $('#sale-stock').textContent='—'; return; }
  const st = await computeStock(parseInt(curId,10), prodId);
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
  const id = parseInt(v, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { kind:'product', id };
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
  if (item.kind === 'product'){
    const p = (await getAll('products')).find(x => x.id === item.id);
    if (p) $('#sale-price').value = p.price;
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
        isActive = (parseInt(btn.dataset.id || '0', 10) === item.id);
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

async function renderExtrasUI(){
  const label = document.getElementById('extras-event-label');
  const note = document.getElementById('extras-disabled-note');
  const listEl = document.getElementById('extras-list');

  const ev = await getActiveEventPOS();
  const enabled = !!ev;

  if (label) label.textContent = enabled ? (ev.name || '—') : '—';
  if (note) note.style.display = enabled ? 'none' : 'block';

  const idsToDisable = ['extra-name','extra-stock','extra-cost','extra-price','extra-low','btn-save-extra'];
  for (const id of idsToDisable){
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  }

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
async function computeStock(eventId, productId){
  const evId = Number(eventId);
  const pid = Number(productId);
  const inv = await getInventoryEntries(evId);
  const ledger = (Array.isArray(inv) ? inv : [])
    .filter(i => i && Number(i.productId) === pid)
    .reduce((a,b)=> a + (Number(b && b.qty) || 0), 0);

  const allSales = await getAll('sales');
  const sold = (Array.isArray(allSales) ? allSales : [])
    .filter(s => s && Number(s.eventId) === evId && Number(s.productId) === pid)
    .reduce((a,b)=> a + (Number(b && b.qty) || 0), 0);

  const out = ledger - sold;
  return Number.isFinite(out) ? out : 0;
}

// =========================================================
// Lotes FIFO (Etapa 1: solo cálculo, sin UI)
// - Fuente de verdad: inventory (restock/adjust con loteCargaId/loteGroupKey)
// - Orden FIFO: orden de entrada al evento (time de la carga)
// - No asigna manualmente; solo calcula distribución y sobrantes "unassigned".
// =========================================================

function lotFifoKeyFromProductPOS(product, productId, fallbackName){
  // Clave por presentación: preferimos P/M/D/L/G; fallback: PID:<id>
  const name = (product && product.name) ? product.name : (fallbackName || '');
  const k = presKeyFromProductNamePOS(name || '');
  if (k) return k;
  const pid = Number(productId);
  if (Number.isFinite(pid) && pid > 0) return 'PID:' + pid;
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
    const pid = Number(s.productId);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const prod = pMap.get(pid) || null;
    const key = lotFifoKeyFromProductPOS(prod, pid, s.productName);
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


// --- Venta por vaso (fraccionamiento de galones) ---
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

async function getEventByIdPOS(eventId){
  const evs = await getAll('events');
  return evs.find(e => e.id === eventId) || null;
}

async function getVasoProductPOS(){
  const prods = await getAll('products');
  // Prioridad: producto marcado como interno para "Venta por vaso"
  return prods.find(p => p && p.internalType === 'cup_portion')
    || prods.find(p => normName(p.name) === 'vaso')
    || null;
}

function fmtMl(value){
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 10) / 10;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return r.toFixed(1);
}

function computeCupStatsFromEvent(ev, allSales){
  const batches = sanitizeFractionBatches(ev && ev.fractionBatches);
  batches.sort((a,b)=> (a.timestamp||'').localeCompare(b.timestamp||''));

  const cupsAvailable = batches.reduce((a,b)=> a + safeInt(b.cupsRemaining, 0), 0);
  const gallonsFractionedTotal = batches.reduce((a,b)=> a + safeInt(b.gallons, 0), 0);
  const cupsCreatedTotal = batches.reduce((a,b)=> a + safeInt(b.cupsCreated, 0), 0);

  let soldPaid = 0;
  let courtesy = 0;

  (allSales || []).forEach(s=>{
    if (!s || !ev || s.eventId !== ev.id) return;
    if (!isCupSaleRecord(s)) return;
    const q = Number(s.qty || 0);
    const qty = Number.isFinite(q) ? q : 0;
    if (s.courtesy || s.isCourtesy) courtesy += Math.abs(qty);
    else soldPaid += Math.abs(qty);
  });

  const remnantMl = batches.reduce((a,b)=> a + (safeInt(b.cupsRemaining, 0) * (Number(b.mlPerCup) || 0)), 0);

  return { batches, cupsAvailable, gallonsFractionedTotal, cupsCreatedTotal, soldPaid, courtesy, remnantMl };
}

async function refreshCupBlock(){
  const evIdRaw = await getMeta('currentEventId');
  const evId = Number(evIdRaw);
  const block = document.getElementById('cup-block');
  if (!block) return;

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  if (!evId){
    setText('cup-available','0');
    setText('cup-gallons','0');
    setText('cup-created','0');
    setText('cup-sold','0');
    setText('cup-courtesy','0');
    setText('cup-remaining','0');
    setText('cup-remnant','0');
    return;
  }

  const ev = await getEventByIdPOS(evId);
  const allSales = await getAll('sales');
  const stats = computeCupStatsFromEvent(ev, allSales);

  setText('cup-available', String(stats.cupsAvailable));
  setText('cup-gallons', String(stats.gallonsFractionedTotal));
  setText('cup-created', String(stats.cupsCreatedTotal));
  setText('cup-sold', String(stats.soldPaid));
  setText('cup-courtesy', String(stats.courtesy));
  setText('cup-remaining', String(stats.cupsAvailable));
  setText('cup-remnant', fmtMl(stats.remnantMl));

  // Default de precio por vaso (si está vacío o en 0)
  try{
    const inp = document.getElementById('cup-price');
    if (inp){
      const cur = parseFloat(inp.value || '0');
      if (!cur){
        const vasoProd = await getVasoProductPOS();
        if (vasoProd && Number(vasoProd.price) > 0) inp.value = vasoProd.price;
      }
    }
  }catch(e){}
}

async function fractionGallonsToCupsPOS(){
  const evId = await getMeta('currentEventId');
  if (!evId){ alert('Selecciona un evento'); return; }

  const ev = await getEventByIdPOS(evId);
  if (!ev){ alert('Evento no encontrado'); return; }
  if (ev.closedAt){ alert('Este evento está cerrado. Reábrelo o activa otro.'); return; }

  const saleDate = document.getElementById('sale-date')?.value || '';
  // Candado: no permitir fraccionamiento ni operaciones de venta si el día está cerrado
  if (!(await guardSellDayOpenOrToastPOS(ev, saleDate))) return;

  const gallonsToFraction = safeInt(document.getElementById('cup-fraction-gallons')?.value, 0);
  const yieldCupsPerGallon = safeInt(document.getElementById('cup-yield')?.value, 22);

  if (!(gallonsToFraction >= 1)) { alert('Galones a fraccionar debe ser un entero >= 1'); return; }
  if (!(yieldCupsPerGallon >= 1)) { alert('Vasos por galón debe ser un entero >= 1'); return; }

  // Validar inventario de Galón (producto terminado) usando el sistema existente
  const products = await getAll('products');
  const galProd = products.find(p => mapProductNameToFinishedId(p.name) === 'galon') || null;
  if (!galProd){
    alert('No encontré el producto "Galón 3750 ml" (antes 3800ml) en Productos. Restaura productos base o créalo.');
    return;
  }

  const stockEvent = await computeStock(evId, galProd.id);
  if (stockEvent < gallonsToFraction){
    alert(`Inventario insuficiente de Galón para este evento. Disponible: ${stockEvent}. Intentas fraccionar: ${gallonsToFraction}.`);
    return;
  }

  // Descontar inventario por evento (ledger) y central (producto terminado)
  try{
    await addAdjust(evId, galProd.id, -gallonsToFraction, `Fraccionado a vasos (${yieldCupsPerGallon} vasos/galón)`);
  }catch(e){
    console.error('No se pudo registrar ajuste de inventario por evento al fraccionar', e);
  }

  try{
    applyFinishedFromSalePOS({ productName: galProd.name, qty: gallonsToFraction }, +1);
  }catch(e){
    console.error('No se pudo actualizar inventario central al fraccionar', e);
  }

  const batchId = 'fb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);
  const cupsCreated = gallonsToFraction * yieldCupsPerGallon;
  const mlPerCup = ML_PER_GALON / yieldCupsPerGallon;

  const batches = sanitizeFractionBatches(ev.fractionBatches);
  batches.push({
    batchId,
    timestamp: new Date().toISOString(),
    gallons: gallonsToFraction,
    yieldCupsPerGallon,
    cupsCreated,
    cupsRemaining: cupsCreated,
    mlPerCup,
    note: ''
  });

  ev.fractionBatches = batches;

  // Persistir fraccionamiento en el evento (esta acción NO crea "sale", así que no pasa por el guardado atómico).
  try{
    const evFresh = await getEventByIdPOS(evId);
    if (evFresh){
      evFresh.fractionBatches = batches;
      await put('events', evFresh);
    } else {
      await put('events', ev);
    }
  }catch(e){
    console.error('No se pudo persistir fraccionamiento en evento', e);
    try{ showPersistFailPOS('fraccionamiento', e); }catch(_){ }
  }

  // Actualizar snapshot de Lotes para este evento (evita "galones fantasma" tras fraccionar a vasos)
  try{ queueLotsUsageSyncPOS(evId); }catch(_){ }

  await renderInventario();
  await refreshSaleStockLabel();
  await refreshCupBlock();
  toast(`Fraccionados ${gallonsToFraction} galón(es) a ${yieldCupsPerGallon} vasos/galón → +${cupsCreated} vasos`);
}

function fifoTakeCups(batches, qty){
  let remaining = qty;
  const breakdown = [];
  const ordered = [...batches].sort((a,b)=> (a.timestamp||'').localeCompare(b.timestamp||''));
  for (const b of ordered){
    if (remaining <= 0) break;
    const avail = safeInt(b.cupsRemaining, 0);
    if (avail <= 0) continue;
    const take = Math.min(avail, remaining);
    if (take > 0){
      b.cupsRemaining = avail - take;
      breakdown.push({ batchId: b.batchId, cupsTaken: take, mlPerCup: b.mlPerCup });
      remaining -= take;
    }
  }
  return { ok: remaining === 0, breakdown };
}

async function sellCupsPOS(isCourtesy){
  const evId = await getMeta('currentEventId');
  if (!evId){ alert('Selecciona un evento'); return; }

  const ev = await getEventByIdPOS(evId);
  if (!ev){ alert('Evento no encontrado'); return; }
  if (ev.closedAt){ alert('Este evento está cerrado. Reábrelo o activa otro.'); return; }

  const date = document.getElementById('sale-date')?.value || '';
  if (!date){ alert('Selecciona una fecha'); return; }

  // Candado: no permitir fraccionamiento ni operaciones de venta si el día está cerrado
  if (!(await guardSellDayOpenOrToastPOS(ev, date))) return;

  const qty = safeInt(document.getElementById('cup-qty')?.value, 0);
  if (!(qty >= 1)) { alert('Cantidad de vasos debe ser un entero >= 1'); return; }

  // Etapa 1: confirmación si no hay cliente seleccionado
  if (!confirmProceedSaleWithoutCustomerPOS()) return;

  const allSales = await getAll('sales');
  const stats = computeCupStatsFromEvent(ev, allSales);
  if (stats.cupsAvailable < qty){
    alert('No hay vasos disponibles. Fraccioná un galón.');
    return;
  }

  const batches = stats.batches; // sanitized
  const taken = fifoTakeCups(batches, qty);
  if (!taken.ok){
    alert('No hay vasos suficientes. Fraccioná un galón.');
    return;
  }

  ev.fractionBatches = batches;
  // Nota: persistencia de cups+venta se hace atómica (events+sales) más abajo

  // Candado: si sección está activada y el día está cerrado, NO permitir ventas por vaso
  if (!(await guardSellDayOpenOrToastPOS(ev, date))) return;

  const payment = document.getElementById('sale-payment')?.value || 'efectivo';
  const customerInputName = getCustomerNameFromUI_POS();
  const customerResolved = resolveCustomerIdForSalePOS(customerInputName, getCustomerIdHintFromUI_POS());
  const customerId = customerResolved ? customerResolved.id : null;
  const customerName = (customerResolved && customerResolved.displayName) ? customerResolved.displayName : customerInputName;

  // Banco (obligatorio si es Transferencia)
  let bankId = null;
  let bankName = '';
  if (payment === 'transferencia'){
    const activeBanks = (await getAllBanksSafe()).filter(b => b && b.isActive !== false);
    if (!activeBanks.length){
      alert('No hay bancos activos. Agregá uno en Productos.');
      return;
    }
    const sel = document.getElementById('sale-bank');
    const raw = sel ? String(sel.value || '').trim() : '';
    const id = parseInt(raw || '0', 10);
    if (!id){
      alert('Selecciona el banco para la transferencia.');
      return;
    }
    const found = activeBanks.find(b => Number(b.id) === id);
    bankId = id;
    bankName = (found && found.name) ? String(found.name) : '';
  }

  let vasoProd = await getVasoProductPOS();
  // Si alguien borró el producto interno "Vaso", lo recreamos (sin exponerlo en el selector)
  if (!vasoProd){
    try{
      const newId = await put('products', {name:'Vaso', price:100, manageStock:false, active:false, internalType:'cup_portion'});
      vasoProd = {id: newId, price:100, manageStock:false, active:false, internalType:'cup_portion'};
    }catch(e){
      console.error('No se pudo preparar producto interno Vaso', e);
      showPersistFailPOS('producto Vaso', e);
      return;
    }
  }
  const productId = vasoProd ? vasoProd.id : 0;

  const unitPrice = isCourtesy ? 0 : parseFloat(document.getElementById('cup-price')?.value || '0');
  if (!isCourtesy && !(unitPrice > 0)){
    alert('Ingresa un precio por vaso (> 0) o usa "Registrar cortesía".');
    return;
  }

  const productName = isCourtesy ? 'Vaso (Cortesía)' : 'Vaso';
  const total = isCourtesy ? 0 : (unitPrice * qty);

  const now = new Date();
  const time = now.toTimeString().slice(0,5);

  // Costo por vaso (COGS): derivado del costo del Galón configurado en Calculadora (Recetas).
  // Usamos el breakdown FIFO (mlPerCup) para estimar el costo exacto por ml servido.
  const costoGallon = getCostoUnitarioProducto('Galón 3750 ml') || getCostoUnitarioProducto('Galón 3750 ml') || getCostoUnitarioProducto('Galón') || 0;
  let lineCost = 0;
  if (costoGallon > 0) {
    const costPerMl = costoGallon / ML_PER_GALON;
    let totalMl = 0;
    for (const it of (taken.breakdown || [])) {
      const cupsTaken = Number(it && it.cupsTaken) || 0;
      const mlPerCup = Number(it && it.mlPerCup) || 0;
      if (cupsTaken > 0 && mlPerCup > 0) totalMl += cupsTaken * mlPerCup;
    }
    if (!(totalMl > 0)) {
      // fallback ultra seguro
      totalMl = qty * (ML_PER_GALON / 22);
    }
    lineCost = round2(costPerMl * totalMl);
  }
  const costPerUnit = (qty > 0) ? round2(lineCost / qty) : 0;
  const lineProfit = round2(total - lineCost);

  const saleRecord = {
    date,
    time,
    createdAt: Date.now(),
    eventId: evId,
    eventName: ev.name || 'General',
    productId,
    productName,
    unitPrice,
    qty,
    discount: 0,
    discountPerUnit: 0,
    payment,
    bankId: (payment === 'transferencia') ? bankId : null,
    bankName: (payment === 'transferencia') ? bankName : null,
    courtesy: !!isCourtesy,
    isCourtesy: !!isCourtesy,
    isReturn: false,
    // Compat: mantenemos "customer" y añadimos "customerName" (nuevo)
    customer: customerName,
    customerName,
    customerId,
    courtesyTo: isCourtesy ? ((document.getElementById('sale-courtesy-to')?.value || '').trim()) : '',
    total,
    notes: isCourtesy ? 'Cortesía por vaso' : 'Venta por vaso',
    costPerUnit,
    lineCost,
    lineProfit,
    vaso: true,
    fifoBreakdown: taken.breakdown
  };

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
      try{ await refreshCupBlock(); }catch(_e){}
      return;
    }
  }catch(_){ }


  // Reservar N° por evento en memoria y guardar atómico (events + sales)
  try{
    const salesForEvent = (allSales || []).filter(s => s && s.eventId === evId);
    const seqInfo = reserveSaleSeqInMemoryPOS(ev, saleRecord, salesForEvent);
    const evUpdated = (seqInfo && seqInfo.eventUpdated) ? seqInfo.eventUpdated : ev;
    const saleId = await saveSaleAndEventAtomicPOS({ saleRecord, eventUpdated: evUpdated });
    saleRecord.id = saleId;
    // Commit en memoria SOLO después de persistir
    try{ if (seqInfo && seqInfo.nextSeq != null) ev.saleSeq = seqInfo.nextSeq; }catch(_){ }
  }catch(err){
    console.error('sellCupsPOS persist error', err);
    showPersistFailPOS('venta por vaso', err);
    try{ await refreshCupBlock(); }catch(_e){}
    return;
  }

  // Invalida cache liviano de Consolidado (ventas del período actual)
  try{
    const pk = periodKeyFromDatePOS(saleRecord.date);
    bumpConsolSalesRevPOS(pk);
    clearConsolLiveCachePOS(pk);
  }catch(_){ }

  try{
    await createJournalEntryForSalePOS(saleRecord);
  }catch(e){
    console.error('No se pudo generar asiento contable para venta por vaso', e);
  }

  // Cliente: catálogo + modo pegajoso
  afterSaleCustomerHousekeepingPOS(customerName, customerId);

  const qtyInp = document.getElementById('cup-qty');
  if (qtyInp) qtyInp.value = 1;

  await renderDay();
  await renderSummary();
  await refreshSaleStockLabel();
  await renderInventario();
  await refreshCupBlock();
  toast(isCourtesy ? 'Cortesía registrada' : 'Venta por vaso agregada');

  // Actualizar snapshot de Lotes para este evento (si hubo fraccionamiento, el Galón debe reflejarse como consumido)
  try{ queueLotsUsageSyncPOS(evId); }catch(_){ }

  // Etapa 2D: limpiar UID pendiente al finalizar el flujo
  clearPendingSaleUidPOS();
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
  await refreshCupBlock();
}


// Importar inventario desde Control de Lotes
async function importFromLoteToInventory(){
  const evSel = $('#inv-event');
  let evId = evSel && evSel.value ? parseInt(evSel.value,10) : null;
  if (!evId){
    alert('Primero selecciona un evento.');
    return;
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
    alert('No se pudo leer la informacion de lotes guardada en el navegador.');
    return;
  }
  if (!lotes.length){
    alert('No hay lotes registrados en el Control de Lotes.');
    return;
  }

  // Helpers de estado (compat: lotes viejos sin campos = DISPONIBLE)
  const normStatus = (status) => {
    const st = (status || '').toString().trim().toUpperCase();
    if (!st) return '';
    if (st === 'EN EVENTO') return 'EN_EVENTO';
    if (st === 'EN_EVENTO') return 'EN_EVENTO';
    if (st === 'DISPONIBLE') return 'DISPONIBLE';
    if (st === 'CERRADO') return 'CERRADO';
    return st;
  };
  const hasAssigned = (l) => (l && l.assignedEventId != null && String(l.assignedEventId).trim() !== '');
  const isAvailable = (l) => {
    const st = normStatus(l?.status);
    if (hasAssigned(l)) return false;
    if (!st) return true; // lotes viejos
    return st === 'DISPONIBLE';
  };

  const available = lotes.filter(isAvailable);
  if (!available.length){
    showToast('No hay lotes disponibles. Los lotes asignados no se pueden cargar de nuevo. Crea otro lote.', 'error', 4200);
    return;
  }

  const listaCodigos = available
    .map(l => (l.codigo || '').trim())
    .filter(c => c)
    .join(', ');

  const codigo = prompt('Escribe el CÓDIGO del lote que quieres asignar a este evento (disponibles: ' + (listaCodigos || 'ninguno') + '):');
  if (!codigo) return;

  const codigoNorm = (codigo || '').toString().toLowerCase().trim();
  const matchFn = (l) => ((l.codigo || '').toString().toLowerCase().trim() === codigoNorm);

  const loteAny = lotes.find(matchFn);
  if (!loteAny){
    alert('No se encontró un lote con ese código.');
    return;
  }

  if (!isAvailable(loteAny)){
    const prevEvName = (loteAny.assignedEventName || '').toString().trim();
    const msg = 'Ese lote ya fue asignado' + (prevEvName ? (' al evento "' + prevEvName + '"') : '') + '. No se puede cargar dos veces.';
    showToast(msg, 'error', 4300);
    return;
  }

  const stamp = new Date().toISOString();
  const cargaId = 'lc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);
  const map = [
    { field: 'pulso', name: 'Pulso 250ml' },
    { field: 'media', name: 'Media 375ml' },
    { field: 'djeba', name: 'Djeba 750ml' },
    { field: 'litro', name: 'Litro 1000ml' },
    { field: 'galon', name: 'Galón 3750 ml' }
  ];

  const products = await getAll('products');
  const norm = s => (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  const items = [];
  let total = 0;
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
    items.push({ productId: prod.id, qty });
    total += qty;
  }

  if (!items.length){
    showToast('Ese lote no trae unidades para cargar (todo está en 0).', 'error', 3800);
    return;
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
    showToast('No se pudo marcar el lote como asignado. No se aplicó la carga.', 'error', 4200);
    return;
  }

  for (const it of items){
    await addRestock(evId, it.productId, it.qty, {
      source: 'lote',
      loteCodigo: (loteAny.codigo || ''),
      loteId: (loteAny.id != null ? loteAny.id : null),
      loteCargaId: cargaId,
      time: stamp,
      notes: 'Reposición (lote ' + (loteAny.codigo || '') + ')'
    });
  }

  await renderInventario();
  await refreshSaleStockLabel();
  showToast('Lote "' + (loteAny.codigo || '') + '" asignado a ' + (evName || 'evento') + ' (' + total + ' u.)', 'ok', 2400);

  // FIFO (Etapa 2): snapshot por evento/lote (entrada de lote al evento)
  try{ queueLotsUsageSyncPOS(evId); }catch(_){ }

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
  const s = String(status || '').trim().toUpperCase();
  if (s === 'DISPONIBLE' || s === 'EN_EVENTO' || s === 'CERRADO') return s;
  return '';
}

function effectiveLoteStatusPOS(lote){
  const st = normLoteStatusPOS(lote && lote.status);
  if (st === 'CERRADO') return 'CERRADO';
  const hasAssigned = (lote && (lote.assignedEventId != null || lote.assignedEventName));
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
    if (evSel && evId) invSel.value = evId;
  }
  if (!evId){
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
      <td><input type="checkbox" class="inv-active" data-id="${p.id}" ${p.active===false?'':'checked'}></td>
      <td><input type="checkbox" class="inv-manage" data-id="${p.id}" ${p.manageStock===false?'':'checked'}></td>
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
    const id = parseInt(e.target.dataset.id||'0',10);
    const all = await getAll('products');
    const cur = all.find(px=>px.id===id); if (!cur) return;
    if (e.target.classList.contains('inv-manage')) cur.manageStock = e.target.checked;
    if (e.target.classList.contains('inv-active')) cur.active = e.target.checked;
    await put('products', cur);
    await renderInventario(); await renderProductChips(); await refreshProductSelect();
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
      const payClass = s.payment==='efectivo'
        ? 'pay-ef'
        : (s.payment==='transferencia' ? 'pay-tr' : 'pay-cr');
      const payTxt = s.payment==='efectivo'
        ? 'Efec'
        : (s.payment==='transferencia' ? (`Transferencia · ${getSaleBankLabel(s, bankMap)}`) : 'Cred');
      const tr = document.createElement('tr');
      const seqTxt = getSaleSeqDisplayPOS(s);
      const timeTxt = getSaleTimeTextPOS(s);
      tr.innerHTML = `<td>${seqTxt ? ('#' + seqTxt + ' · ') : ''}${timeTxt}</td>
        <td>${escapeHtml(uiProductNamePOS(s.productName))}</td>
        <td>${s.qty}</td>
        <td>${fmt(s.unitPrice)}</td>
        <td>${fmt(getSaleDiscountTotalPOS(s))}</td>
        <td>${fmt(s.total)}</td>
        <td><span class="tag ${payClass}">${payTxt}</span></td>
        <td>${s.courtesy?'✓':''}</td>
        <td>${s.isReturn?'✓':''}</td>
        <td>${s.customerName||s.customer||''}</td>
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
  try{
    const rawId = (s && s.customerId != null) ? String(s.customerId).trim() : '';
    if (rawId){
      finalId = resolver ? (resolver.resolveFinalId(rawId) || rawId) : rawId;
    } else {
      const nm = sanitizeCustomerDisplayPOS(s && s.customerName || '');
      if (nm && resolver){
        finalId = resolver.matchNameToFinalId(nm) || '';
      }
    }
  }catch(_){ }

  const rawName = sanitizeCustomerDisplayPOS(s && s.customerName || '');
  let displayName = rawName;
  if (finalId && resolver){
    displayName = resolver.getDisplayName(finalId) || rawName || displayName;
  }
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
  if (btnAll) btnAll.disabled = inArchive;

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

function renderSummaryFromSnapshotPOS(archive){
  const a = archive || {};
  const snap = (a.snapshot && typeof a.snapshot === 'object') ? a.snapshot : {};
  const sheets = Array.isArray(snap.sheets) ? snap.sheets : [];
  const m = (snap.metrics && typeof snap.metrics === 'object') ? snap.metrics : {};

  const grand = Number(m.grand || 0) || 0;
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

  const byProdRows = readSheetRowsPOS(sheets, 'PorProducto').slice(1)
    .map(r=>({ k: String((r&&r[0])||'').trim(), v: Number((r&&r[1])||0) || 0 }))
    .filter(it=>it.k);
  byProdRows.sort((a,b)=>a.k.localeCompare(b.k,'es-NI'));

  const tbP = document.querySelector('#tbl-por-prod tbody');
  if (tbP){
    tbP.innerHTML = '';
    for (const it of byProdRows){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(it.k)}</td><td>${fmt(it.v)}</td>`;
      tbP.appendChild(tr);
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
      tr.innerHTML = `<td>${escapeHtml(it.k)}</td><td>${fmt(it.v)}</td>`;
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

  const getLineCost = (s) => {
    if (!s) return 0;
    if (typeof s.lineCost === 'number' && Number.isFinite(s.lineCost)) return Number(s.lineCost || 0);
    if (typeof s.costPerUnit === 'number' && Number.isFinite(s.costPerUnit)){
      const qty = Number(s.qty || 0);
      return Number(s.costPerUnit || 0) * qty;
    }
    return 0;
  };

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

      byDay.set(s.date, (byDay.get(s.date) || 0) + total);
      byProd.set(s.productName, (byProd.get(s.productName) || 0) + total);
      byPay.set(s.payment || 'efectivo', (byPay.get(s.payment || 'efectivo') || 0) + total);
      byEvent.set(s.eventName || 'General', (byEvent.get(s.eventName || 'General') || 0) + total);

      // Transferencias por banco
      if ((s.payment || '') === 'transferencia'){
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
        custKey = 'id:' + ident.finalId;
        custFilterType = 'id';
        custFilterValue = ident.finalId;
        custName = (resolver ? (resolver.getDisplayName(ident.finalId) || '') : '') || ident.rawName || ident.displayName || 'Cliente';
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

      const pname = normalizeCourtesyProductName(s.productName);
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
      byEvent.set(ev.name, (byEvent.get(ev.name) || 0) + (t.grand || 0));

      if (t.byPay){
        for (const k of Object.keys(t.byPay)){
          byPay.set(k, (byPay.get(k) || 0) + (t.byPay[k] || 0));
        }
      }

      // Por producto: excluir cualquier llave tipo "(Cortesía)"
      if (t.byProduct){
        for (const k of Object.keys(t.byProduct)){
          if (/\(Cortesía\)/i.test(String(k))) continue;
          byProd.set(k, (byProd.get(k) || 0) + (t.byProduct[k] || 0));
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
  if (!costEl || !profitEl || !courCostEl || !profitAfterEl){
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
    [...byProd.entries()]
      .filter(([k,_v])=> !(/\(Cortesía\)/i.test(String(k))))
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'es-NI'))
      .forEach(([k,v])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${fmt(v)}</td>`;
        tbP.appendChild(tr);
      });
  }

  const tbPay = document.querySelector('#tbl-por-pago tbody');
  if (tbPay){
    tbPay.innerHTML = '';
    [...byPay.entries()]
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'es-NI'))
      .forEach(([k,v])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${fmt(v)}</td>`;
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
    const isGlobal = isSummaryEventGlobalPOS(selectedSummaryEventId);

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

  // Confirmación clara del evento antes de ejecutar el cierre
  {
    const msg = 'Vas a cerrar el día de:\n\n' + (ev.name||'—') + '\n\nFecha: ' + dayKey + '\n\nEsto bloqueará ventas y operaciones para este día.\n\n¿Confirmas?';
    if (!confirm(msg)) return;
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

  const getLineCost = (s) => {
    if (!s) return 0;
    if (typeof s.lineCost === 'number' && Number.isFinite(s.lineCost)) return Number(s.lineCost || 0);
    if (typeof s.costPerUnit === 'number' && Number.isFinite(s.costPerUnit)){
      const qty = Number(s.qty || 0);
      return Number(s.costPerUnit || 0) * qty;
    }
    return 0;
  };

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
  let grandCost = 0;
  let grandProfit = 0;

  let courtesyCost = 0;
  let courtesyQty = 0;
  let courtesyEquiv = 0;
  let courtesyTx = 0;
  const courtesyByProd = new Map();

  const byDay = new Map();
  const byProd = new Map();
  const byPay = new Map();
  const byEvent = new Map();

  for (const s of (sales || [])){
    if (!s) continue;
    const total = Number(s.total || 0);
    const courtesy = isCourtesySale(s);

    if (!courtesy){
      grand += total;
      byDay.set(s.date, (byDay.get(s.date) || 0) + total);
      byProd.set(s.productName, (byProd.get(s.productName) || 0) + total);
      byPay.set(s.payment || 'efectivo', (byPay.get(s.payment || 'efectivo') || 0) + total);
      byEvent.set(s.eventName || 'General', (byEvent.get(s.eventName || 'General') || 0) + total);

      if ((s.payment || '') === 'transferencia'){
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

      const pname = normalizeCourtesyProductName(s.productName);
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

  // Tablawt helper: para el Excel, listas ordenadas
  const sortMapDesc = (m) => Array.from(m.entries()).map(([k,v])=>({ key:k, val:v }))
    .sort((a,b)=> (Number(b.val||0) - Number(a.val||0)));
  const sortMapDateAsc = (m) => Array.from(m.entries()).map(([k,v])=>({ key:k, val:v }))
    .sort((a,b)=> String(a.key).localeCompare(String(b.key)));

  return {
    periodKey,
    periodLabel: periodLabelPOS(periodKey),
    metrics: {
      grand,
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
    byProd: sortMapDesc(byProd),
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
  r.push(['Total general', m.grand || 0]);
  r.push(['Costo estimado', m.grandCost || 0]);
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
  const pRows = [['Producto','Total C$']];
  for (const it of (data.byProd || [])) pRows.push([it.key, it.val || 0]);
  sheets.push({ name: 'PorProducto', rows: pRows });

  // Hoja PorPago
  const payRows = [['Método','Total C$']];
  for (const it of (data.byPay || [])) payRows.push([it.key, it.val || 0]);
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
    const ws = XLSX.utils.aoa_to_sheet(sh.rows || []);
    XLSX.utils.book_append_sheet(wb, ws, sh.name || 'Hoja');
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

  const acc = { grand:0, grandCost:0, grandProfit:0, courtesyCost:0, profitAfterCourtesy:0, courtesyQty:0, courtesyTx:0, courtesyEquiv:0 };

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
  const grandCost = __numPOS(m && m.grandCost);
  const grandProfit = __numPOS(m && m.grandProfit);
  const courtesyCost = __numPOS(m && m.courtesyCost);
  const courtesyQty = __numPOS(m && m.courtesyQty);
  const courtesyTx = __numPOS(m && m.courtesyTx);
  const courtesyEquiv = __numPOS(m && m.courtesyEquiv);
  const profitAfterCourtesy = (m && m.profitAfterCourtesy != null) ? __numPOS(m.profitAfterCourtesy) : (grandProfit - courtesyCost);
  return { grand, grandCost, grandProfit, courtesyCost, profitAfterCourtesy, courtesyQty, courtesyTx, courtesyEquiv };
}

function zeroArchiveMetricsPOS(){
  return { grand:0, grandCost:0, grandProfit:0, courtesyCost:0, profitAfterCourtesy:0, courtesyQty:0, courtesyTx:0, courtesyEquiv:0 };
}

function sumArchiveMetricsPOS(a, b){
  const x = normalizeArchiveMetricsPOS(a || {});
  const y = normalizeArchiveMetricsPOS(b || {});
  return {
    grand: x.grand + y.grand,
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
  const prods = await getAll('products');
  const inv = await getInventoryEntries(eventId);
  const sales = await getAll('sales');
  const rows = [['producto','manejar','inicial','reposiciones','ajustes','vendido','stock_actual']];
  for (const p of prods){
    const inits = inv.filter(i=>i.productId===p.id && i.type==='init').reduce((a,b)=>a+(b.qty||0),0);
    const repo = inv.filter(i=>i.productId===p.id && i.type==='restock').reduce((a,b)=>a+(b.qty||0),0);
    const adj = inv.filter(i=>i.productId===p.id && i.type==='adjust').reduce((a,b)=>a+(b.qty||0),0);
    const sold = sales.filter(s=>s.eventId===eventId && s.productId===p.id).reduce((a,b)=>a+(b.qty||0),0);
    const stock = inits + repo + adj - sold;
    rows.push([p.name, p.manageStock!==false?1:0, inits, repo, adj, sold, stock]);
  }
  downloadExcel('inventario_evento.xlsx', 'Inventario', rows);
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

  // --- Costos (incluye vasos usando costo del Galón / rendimiento de fraccionamiento) ---
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
      // Preferir lineCost si ya existe, si no, estimar por galón/yield.
      const stored = Number(s.lineCost || 0);
      const estimated = estimateCupCostSigned(s);
      const lineCost = (Math.abs(stored) > 1e-9) ? stored : estimated;

      costoProductos += lineCost;

      if (isCourtesy){
        cortesiasVasosU += absQty;
        costoCortesiasVasos += lineCost;
      }
    } else {
      const unitCost = getCostoUnitarioProducto(s.productName);
      if (unitCost > 0 && qtyParaCosto !== 0) {
        const lineCost = unitCost * qtyParaCosto;
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
    const k = (s && s.payment) ? s.payment : '';
    m[k] = (m[k] || 0) + (Number(s && s.total) || 0); 
    return m; 
  },{});

  const costoCortesiasTotalKnown = costoCortesiasPres + (canEstimateCupCost ? costoCortesiasVasos : 0);

  $('#ev-totals').innerHTML = `<div><b>Total vendido (pagado):</b> C$ ${fmt(total)}</div>
  <div><b>Cortesías presentaciones:</b> ${Math.round(cortesiasPresU)} unid.</div>
  <div><b>Cortesías vasos:</b> ${Math.round(cortesiasVasosU)} vasos</div>
  <div><b>Costo cortesías presentaciones:</b> C$ ${fmt(costoCortesiasPres)}</div>
  <div><b>Costo cortesías vasos:</b> ${canEstimateCupCost ? ('C$ ' + fmt(costoCortesiasVasos)) : 'N/D'}</div>
  <div><b>Costo cortesías total:</b> ${canEstimateCupCost ? ('C$ ' + fmt(costoCortesiasTotalKnown)) : ('C$ ' + fmt(costoCortesiasPres) + ' + N/D')}</div>
  <div><b>Costo estimado de producto:</b> C$ ${fmt(costoProductos)}</div>
  <div><b>Utilidad bruta aprox.:</b> C$ ${fmt(utilidadBruta)}</div>
  <div><b>Efectivo:</b> C$ ${fmt(byPay.efectivo||0)}</div>
  <div><b>Transferencia:</b> C$ ${fmt(byPay.transferencia||0)}</div>
  <div><b>Crédito:</b> C$ ${fmt(byPay.credito||0)}</div>`;

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
      const k = (s && s.productName) ? uiProductNamePOS(s.productName) : '—';
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
    const payLabel = (s.payment === 'transferencia')
      ? (`Transferencia · ${getSaleBankLabel(s, bankMap)}`)
      : (s.payment || '');
    const tr=document.createElement('tr'); tr.innerHTML = `<td>${getSaleSeqDisplayPOS(s)}</td><td>${s.date}</td><td>${getSaleTimeTextPOS(s)}</td><td>${escapeHtml(uiProductNamePOS(s.productName))}</td><td>${s.qty}</td><td>${fmt(s.unitPrice)}</td><td>${fmt(getSaleDiscountTotalPOS(s))}</td><td>${fmt(s.total)}</td><td>${payLabel}</td><td>${s.courtesy?'✓':''}</td><td>${s.isReturn?'✓':''}</td><td>${s.customerName||s.customer||''}</td><td>${s.courtesyTo||''}</td><td>${s.notes||''}</td>`;
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
    const bank = (s.payment === 'transferencia') ? getSaleBankLabel(s, bankMap) : '';
    rows.push([ (s.seqId || ''), s.id, s.date, getSaleTimeTextPOS(s), uiProductNamePOS(s.productName), s.qty, s.unitPrice, getSaleDiscountTotalPOS(s), s.total, (s.payment||''), bank, s.courtesy?1:0, s.isReturn?1:0, s.courtesyTo||'', s.notes||'', s.customerName||s.customer||'']);
  }
  const safeName = (ev?ev.name:'evento').replace(/[^a-z0-9_\- ]/gi,'_');
  downloadExcel(`ventas_${safeName}.xlsx`, 'Ventas', rows);
}
function buildCorteSummaryRows(eName, sales){
  let efectivo=0, trans=0, credito=0, descuentos=0, cortesiasU=0, cortesiasVal=0, devolU=0, devolVal=0, bruto=0;
  for (const s of sales){
    const absQty = Math.abs(s.qty||0);
    const absTotal = Math.abs(s.total||0);
    const disc = getSaleDiscountTotalPOS(s);
    bruto += (s.courtesy ? (s.unitPrice*absQty) : (absTotal + disc));
    descuentos += disc * (s.isReturn?-1:1);
    if (s.courtesy){ cortesiasU += absQty; cortesiasVal += (s.unitPrice*absQty); }
    if (s.isReturn){ devolU += absQty; devolVal += absTotal; }
    if (s.payment==='efectivo') efectivo += s.total;
    else if (s.payment==='transferencia') trans += s.total;
    else if (s.payment==='credito'){ credito += s.total; }
  }
  const cobrado = efectivo + trans;
  const neto = cobrado;
  return {efectivo, trans, credito, descuentos, cortesiasU, cortesiasVal, devolU, devolVal, bruto, cobrado, neto};
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
    if ((s.payment || '') !== 'transferencia') continue;
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
  rows.push(['Crédito', sum.credito.toFixed(2)]);
  rows.push(['Cobrado (sin crédito)', sum.cobrado.toFixed(2)]);
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
  rows.push(['id','fecha','hora','producto','cant','PU','desc_C$','total','pago','banco','cortesia','devolucion','cortesia_a','notas','cliente']);
  for (const s of sales){
    const bank = (s.payment === 'transferencia') ? getSaleBankLabel(s, bankMap) : '';
    rows.push([s.id, s.date, getSaleTimeTextPOS(s), uiProductNamePOS(s.productName), s.qty, s.unitPrice, getSaleDiscountTotalPOS(s), s.total, (s.payment||''), bank, s.courtesy?1:0, s.isReturn?1:0, s.courtesyTo||'', s.notes||'', s.customerName||s.customer||'']);
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
    if ((s.payment || '') !== 'transferencia') continue;
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
    const pay = s.payment || 'desconocido';
    m[pay] = (m[pay] || 0) + (s.total || 0);
    return m;
  },{});
  resumenRows.push([]);
  resumenRows.push(['Cobros por forma de pago']);
  resumenRows.push(['Efectivo C$', byPay.efectivo || 0]);
  resumenRows.push(['Transferencia C$', byPay.transferencia || 0]);
  resumenRows.push(['Crédito C$', byPay.credito || 0]);

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
  ventasRows.push(['N°','id','fecha','hora','producto','cantidad','PU_C$','descuento_C$','total_C$','costo_unit_C$','costo_total_C$','pago','banco','cortesia','devolucion','cortesia_a','notas','cliente']);
  for (const s of sales){
    const qty = Number(s.qty || 0);
    const costUnit = Number.isFinite(Number(s.costPerUnit)) ? Number(s.costPerUnit) : 0;
    const costTotal = Number.isFinite(Number(s.lineCost)) ? Number(s.lineCost) : (costUnit * qty);
    ventasRows.push([
      getSaleSeqDisplayPOS(s),
      s.id,
      s.date || '',
      getSaleTimeTextPOS(s) || '',
      s.productName || '',
      qty || 0,
      s.unitPrice || 0,
      getSaleDiscountTotalPOS(s) || 0,
      s.total || 0,
      costUnit || 0,
      costTotal || 0,
      s.payment || '',
      (s.payment === 'transferencia') ? getSaleBankLabel(s, bankMap) : '',
      s.courtesy ? 1 : 0,
      s.isReturn ? 1 : 0,
      s.courtesyTo || '',
      s.notes || '',
      s.customerName || s.customer || ''
    ]);
  }
  const wsVentas = XLSX.utils.aoa_to_sheet(ventasRows);
  XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas_Detalle');

  const safeName = (ev.name || 'evento').replace(/[^a-z0-9_\- ]/gi,'_');
  XLSX.writeFile(wb, `evento_${safeName}.xlsx`);
}

// --- Close / Reopen / Activate / Delete ---
async function closeEvent(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){ alert('Evento no encontrado'); return; }
  if (ev.closedAt){ alert('Este evento ya está cerrado.'); return; }


  // Corte (Excel). Si falla, permitir cerrar de todas formas.
  try{
    await generateCorteCSV(eventId);
  } catch(err){
    console.error('generateCorteCSV error', err);
    const ok = confirm(
      'No se pudo generar el Corte (Excel) por un error.\n\n¿Cerrar el evento de todas formas?\n(Podrás exportar después desde Eventos: “Exportar (Excel)” o “CSV Corte”.)'
    );
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
  await seedMissingDefaults(true);
  await renderProductos(); await refreshProductSelect(); await renderInventario();
  toast('Productos base restaurados');
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
  await runStep('refreshEventUI', refreshEventUI);
  await runStep('refreshProductSelect', refreshProductSelect);
  await runStep('refreshSaleBankSelect', refreshSaleBankSelect);
  await runStep('renderDay', renderDay);
  await runStep('refreshCupBlock', refreshCupBlock);
  await runStep('renderSummary', renderSummary);
  await runStep('renderProductos', renderProductos);
  await runStep('renderEventos', renderEventos);
  await runStep('renderInventario', renderInventario);
  await runStep('updateSellEnabled', updateSellEnabled);
  await runStep('initVasosPanel', initVasosPanelPOS);
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

  // Venta por vaso (fraccionamiento de galones)
  const btnFraction = document.getElementById('btn-fraction');
  if (btnFraction) btnFraction.addEventListener('click', fractionGallonsToCupsPOS);

  const btnSellCups = document.getElementById('btn-sell-cups');
  if (btnSellCups) btnSellCups.addEventListener('click', ()=> sellCupsPOS(false));

  const btnCourtesyCups = document.getElementById('btn-courtesy-cups');
  if (btnCourtesyCups) btnCourtesyCups.addEventListener('click', ()=> sellCupsPOS(true));

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
      if (last && presKeyFromProductNamePOS(last.productName)) {
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
        if (saleToDelete && presKeyFromProductNamePOS(saleToDelete.productName)) {
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

  // Stepper (Venta por vaso)
  const cupQtyInp = document.getElementById('cup-qty');
  const cupMinus = document.getElementById('cup-qty-minus');
  const cupPlus = document.getElementById('cup-qty-plus');
  if (cupMinus && cupQtyInp) cupMinus.addEventListener('click', ()=>{
    const v = Math.max(1, parseInt(cupQtyInp.value || '1', 10) - 1);
    cupQtyInp.value = v;
  });
  if (cupPlus && cupQtyInp) cupPlus.addEventListener('click', ()=>{
    const v = Math.max(1, parseInt(cupQtyInp.value || '1', 10) + 1);
    cupQtyInp.value = v;
  });

  // Productos: agregar + restaurar
  document.getElementById('btn-add-prod').onclick = async()=>{ const name = $('#new-name').value.trim(); const price = parseFloat($('#new-price').value||'0'); if (!name || !(price>0)) return alert('Nombre y precio'); try{ await put('products', {name, price, manageStock:true, active:true}); $('#new-name').value=''; $('#new-price').value=''; await renderProductos(); await refreshProductSelect(); await renderInventario(); toast('Producto agregado'); }catch(err){ alert('No se pudo agregar. ¿Nombre duplicado?'); } };
  document.getElementById('btn-restore-seed').onclick = restoreSeed;

  // Bancos: agregar desde pestaña Productos
  const addBankBtn = document.getElementById('btn-add-bank');
  if (addBankBtn){
    addBankBtn.onclick = async ()=>{
      const input = document.getElementById('bank-new-name');
      const raw = (input?.value || '').trim();
      if (!raw){ alert('Nombre del banco'); return; }

      const banks = await getAllBanksSafe();
      const key = normBankName(raw);
      const dup = banks.find(b => normBankName(b?.name) === key);
      if (dup){
        if (dup.isActive === false){
          if (confirm('Ese banco ya existe pero está inactivo. ¿Activarlo?')){
            dup.isActive = true;
            await put('banks', dup);
            if (input) input.value = '';
            await renderBancos();
            await refreshSaleBankSelect();
            toast('Banco activado');
          }
          return;
        }
        alert('Ese banco ya existe.');
        return;
      }

      await put('banks', { name: raw, isActive: true, createdAt: new Date().toISOString() });
      if (input) input.value = '';
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
  if (btnFromLote) btnFromLote.addEventListener('click', importFromLoteToInventory);

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
  const productId = (parsed && parsed.kind === 'product') ? parsed.id : parseInt(selVal||'0',10);
  const qtyRaw = parseNumPOS($('#sale-qty').value, 0);
  const qty = Math.abs(qtyRaw);
  const priceRaw = parseNumPOS($('#sale-price').value, 0);
  const price = priceRaw;
  const discStr = ($('#sale-discount') ? $('#sale-discount').value : '');
  const discTrim = String(discStr ?? '').trim();
  const discParsed = parseNumPOS(discStr, 0);
  if (discTrim && !Number.isFinite(discParsed)) { alert('Descuento inválido'); return; }
  if (Number.isFinite(discParsed) && discParsed < 0) { alert('Descuento inválido'); return; }
  const discountPerUnit = Math.max(0, Number.isFinite(discParsed) ? discParsed : 0);
  const payment = $('#sale-payment').value;
  const courtesy = $('#sale-courtesy').checked;
  const isReturn = $('#sale-return').checked;
  const customerInputName = getCustomerNameFromUI_POS();
  const customerResolved = resolveCustomerIdForSalePOS(customerInputName, getCustomerIdHintFromUI_POS());
  const customerId = customerResolved ? customerResolved.id : null;
  const customerName = (customerResolved && customerResolved.displayName) ? customerResolved.displayName : customerInputName;
  const courtesyTo = $('#sale-courtesy-to').value || '';
  const notes = $('#sale-notes').value || '';
  if (!date || !productId || !qty) { alert('Completa fecha, producto y cantidad'); return; }

  // Regla final: descuento por unidad NO puede superar el precio unitario (si no es cortesía)
  if (!courtesy && Number.isFinite(price) && discountPerUnit > price + 1e-9) {
    alert('Descuento por unidad no puede ser mayor que el precio unitario');
    return;
  }


  // Etapa 1: confirmación si no hay cliente seleccionado
  if (!confirmProceedSaleWithoutCustomerPOS()) return;

  // Banco (obligatorio si es Transferencia)
  let bankId = null;
  let bankName = '';
  if (payment === 'transferencia'){
    const activeBanks = (await getAllBanksSafe()).filter(b => b && b.isActive !== false);
    if (!activeBanks.length){
      alert('No hay bancos activos. Agregá uno en Productos.');
      return;
    }
    const sel = document.getElementById('sale-bank');
    const raw = sel ? String(sel.value || '').trim() : '';
    const id = parseInt(raw || '0', 10);
    if (!id){
      alert('Selecciona el banco para la transferencia.');
      return;
    }
    const found = activeBanks.find(b => Number(b.id) === id);
    bankId = id;
    bankName = (found && found.name) ? String(found.name) : '';
  }

  const events = await getAll('events');
  const event = events.find(e=>e.id===curId);
  if (!event || event.closedAt){ alert('Este evento está cerrado. Reábrelo o activa otro.'); return; }

  // Candado: si sección está activada y el día está cerrado, NO permitir ventas
  if (!(await guardSellDayOpenOrToastPOS(event, date))) return;

  const products = await getAll('products');
  const prod = products.find(p=>p.id===productId);
  const productName = prod ? prod.name : 'N/D';

  // Etapa 4: Presentaciones con lote → no vender sin lotes asignados/disponibles
  if (!isReturn){
    const lotGuard = await guardLotAvailabilityBeforeSalePOS(curId, productName, qty);
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

  if (prod && prod.manageStock!==false && !isReturn){
    const st = await computeStock(curId, productId);
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

  const unitCost = getCostoUnitarioProducto(productName);
  const lineCost = unitCost * finalQty;
  const lineProfit = total - lineCost;

  const eventName = event ? event.name : 'General';
  const now = new Date(); const time = now.toTimeString().slice(0,5);

  // Nota: inventario central se ajusta SOLO si la venta quedó persistida (evita estados a medias)

  const saleRecord = {
    date,
    time,
    createdAt: Date.now(),
    eventId:curId,
    eventName,
    productId,
    productName,
    unitPrice:price,
    qty:finalQty,
    discount,
    discountPerUnit: discountPerUnitEff,
    payment,
    bankId: (payment === 'transferencia') ? bankId : null,
    bankName: (payment === 'transferencia') ? bankName : null,
    courtesy,
    isReturn,
    // Compat: mantenemos "customer" y añadimos "customerName" (nuevo)
    customer: customerName,
    customerName,
    customerId,
    courtesyTo,
    total,
    notes,
    costPerUnit:unitCost,
    lineCost,
    lineProfit
  };

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
    applyFinishedFromSalePOS({ productName, qty: finalQty }, +1);
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
  const payment = $('#sale-payment').value;
  const courtesy = $('#sale-courtesy').checked;
  const isReturn = $('#sale-return').checked;
  const customerInputName = getCustomerNameFromUI_POS();
  const customerResolved = resolveCustomerIdForSalePOS(customerInputName, getCustomerIdHintFromUI_POS());
  const customerId = customerResolved ? customerResolved.id : null;
  const customerName = (customerResolved && customerResolved.displayName) ? customerResolved.displayName : customerInputName;
  const courtesyTo = $('#sale-courtesy-to').value || '';
  const notes = $('#sale-notes').value || '';

  if (!date || !qty) { alert('Completa fecha y cantidad'); return; }

  // Etapa 1: confirmación si no hay cliente seleccionado
  if (!confirmProceedSaleWithoutCustomerPOS()) return;

  // Candado: si el día está cerrado (sección o Resumen), NO permitir ventas
  if (!(await guardSellDayOpenOrToastPOS(ev, date))) return;

  // Candado: si sección está activada y el día está cerrado, NO permitir ventas
  if (!(await guardSellDayOpenOrToastPOS(ev, date))) return;

  // Banco (obligatorio si es Transferencia)
  let bankId = null;
  let bankName = '';
  if (payment === 'transferencia'){
    const activeBanks = (await getAllBanksSafe()).filter(b => b && b.isActive !== false);
    if (!activeBanks.length){
      alert('No hay bancos activos. Agregá uno en Productos.');
      return;
    }
    const sel = document.getElementById('sale-bank');
    const raw = sel ? String(sel.value || '').trim() : '';
    const id = parseInt(raw || '0', 10);
    if (!id){
      alert('Selecciona el banco para la transferencia.');
      return;
    }
    const found = activeBanks.find(b => Number(b.id) === id);
    bankId = id;
    bankName = (found && found.name) ? String(found.name) : '';
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
  const lineCost = costPerUnit * finalQty;
  const lineProfit = total - lineCost;

  const saleRecord = {
    id: Date.now(),
    eventId: curId,
    eventName: ev.name,
    date,
    time,
    productId: null,
    productName: extra.name,
    isExtra: true,
    extraId: extra.id,
    qty: finalQty,
    unitPrice,
    discount,
    discountPerUnit,
    total,
    payment,
    bankId,
    bankName,
    // Compat: mantenemos "customer" y añadimos "customerName" (nuevo)
    customer: customerName,
    customerName,
    customerId,
    courtesy,
    courtesyTo,
    notes,
    isReturn,
    createdAt: Date.now(),
    costPerUnit,
    lineCost,
    lineProfit
  };

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

  await renderDay();
  await renderSummary();
  await renderExtrasUI();
  await refreshProductSelect({ keepSelection:true });

  toast(courtesy ? 'Cortesía de Extra registrada' : 'Venta de Extra registrada');


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
    const pago = s.payment || 'otro';

    data.totalGrupo += t;
    if (!data.porPago[pago]) data.porPago[pago] = 0;
    data.porPago[pago] += t;

    if ((s.payment || '') === 'transferencia'){
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
      html += `<li>${metodo}: C$ ${fmt(data.porPago[metodo])}</li>`;
      ya.add(metodo);
    }
  }
  for (const metodo in data.porPago){
    if (!ya.has(metodo)){
      html += `<li>${metodo}: C$ ${fmt(data.porPago[metodo])}</li>`;
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
      resumenRows.push([metodo, data.porPago[metodo]]);
      ya.add(metodo);
    }
  }
  for (const metodo in data.porPago){
    if (!ya.has(metodo)){
      resumenRows.push([metodo, data.porPago[metodo]]);
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


const A33_POS_CALC_FX_LS_KEY = 'A33_POS_CALC_FX_RATE';

function posCalcSafeLSGet(key){
  try{
    if (typeof window === 'undefined') return null;
    if (!window.localStorage) return null;
    return window.localStorage.getItem(String(key));
  }catch(_){ return null; }
}

function posCalcSafeLSSet(key, value){
  try{
    if (typeof window === 'undefined') return false;
    if (!window.localStorage) return false;
    window.localStorage.setItem(String(key), String(value));
    return true;
  }catch(_){ return false; }
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

function posCalcRound2(n){
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

function posCalcFmt2(n){
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return (Math.round(x * 100) / 100).toFixed(2);
}

// REQUISITO CLAVE: source of truth = sección (solo lectura)
// Devuelve el tipo de cambio actual usado por sección para el evento activo.
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
        fxShowStatus('Ingresa un tipo de cambio válido para convertir.');
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
        fxShowStatus('Ingresa un tipo de cambio válido para convertir.');
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



  function fxPersistRate(){
    try{
      if (!els.fxRate) return;
      const n = posCalcParsePositiveNumber(els.fxRate.value);
      if (!n) return; // NO sobreescribir lo guardado con vacío/invalid
      const fixed = posCalcFmt2(n);
      try{ els.fxRate.value = fixed; }catch(_){ }
      posCalcSafeLSSet(A33_POS_CALC_FX_LS_KEY, fixed);
    }catch(_){ }
  }

  // Bind conversor FX
  if (els.fxUsd) els.fxUsd.addEventListener('input', fxUpdateFromUSD);
  if (els.fxNio) els.fxNio.addEventListener('input', fxUpdateFromNIO);
  if (els.fxRate){
    els.fxRate.addEventListener('input', ()=>{ fxShowStatus(''); fxRecompute(); });
    els.fxRate.addEventListener('change', fxPersistRate);
    els.fxRate.addEventListener('blur', fxPersistRate);
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

  // Precargar (y normalizar) tipo de cambio guardado: siempre 2 decimales.
  try{
    const saved = posCalcSafeLSGet(A33_POS_CALC_FX_LS_KEY);
    const nSaved = posCalcParsePositiveNumber(saved);
    const curN = posCalcParsePositiveNumber(rateEl.value);
    if (nSaved) rateEl.value = posCalcFmt2(nSaved);
    else if (curN) rateEl.value = posCalcFmt2(curN);
  }catch(_){ }

  const ev = await getActiveEventPOS();

  // Tipo de cambio manual (se guarda localmente en este dispositivo).
  rateEl.readOnly = false;
  rateEl.title = 'Tipo de cambio (se guarda en este dispositivo)';

  if (ev){
    metaEl.textContent = `Evento activo: ${ev.name} · Tipo de cambio manual (guardado)`;
    statusEl.textContent = 'Este tipo de cambio se guarda en este dispositivo.';
  } else {
    metaEl.textContent = 'Sin evento activo · Tipo de cambio manual (guardado)';
    statusEl.textContent = 'Este tipo de cambio se guarda en este dispositivo.';
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