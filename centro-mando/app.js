/*
  Suite A33 v4.20.5 — Centro de Mando (OPERATIVO v1)

  Fuentes reales (descubiertas en /pos/app.js dentro de esta ZIP):
  - DB_NAME: 'a33-pos'
  - Stores: meta, events, sales, pettyCash, products, inventory, banks
  - Meta key del evento actual: id='currentEventId' (value = number|null)

  Regla clave: NO inventar números.
  Si no se puede leer/calcular fácil y seguro, mostrar “—” + “No disponible”.
*/

// --- Constantes (descubiertas, no adivinadas)
const POS_DB_NAME = 'a33-pos';
const LS_FOCUS_KEY = 'a33_cmd_focusEventId';
const ORDERS_LS_KEY = 'arcano33_pedidos';
const ORDERS_ROUTE = '../pedidos/index.html';
const SAFE_SCAN_LIMIT = 4000; // seguridad: evitar loops gigantes

// --- Recordatorios (índice liviano desde POS)
const REMINDERS_STORE = 'posRemindersIndex';
const REMINDERS_SHOW_DONE_KEY = 'a33_cmd_reminders_showDone_v1';

// --- Recomendaciones (desde Analítica: cache en localStorage)
const ANALYTICS_RECOS_KEY = 'a33_analytics_recos_v1';
const ANALYTICS_ROUTE = '../analitica/index.html';

// --- Inventario (localStorage) — solo lectura (NO tocar estructura)
const INV_LS_KEY = 'arcano33_inventario';
const INV_ROUTE = '../inventario/index.html';
const CALC_ROUTE = '../calculadora/index.html';
let calcRouteAvailable = true;

// UI state (se queda abierto hasta que el usuario lo cierre)
const invViewState = {
  liquidsExpanded: false,
  bottlesExpanded: false,
};

// Nombres (alineados al módulo Inventario; si hay claves nuevas, se muestran por id)
const INV_LIQUIDS_META = [
  { id:'vino',   name:'Vino' },
  { id:'vodka',  name:'Vodka' },
  { id:'jugo',   name:'Jugo' },
  { id:'sirope', name:'Sirope' },
  { id:'agua',   name:'Agua pura' },
];

const INV_BOTTLES_META = [
  { id:'pulso', name:'Pulso 250 ml' },
  { id:'media', name:'Media 375 ml' },
  { id:'djeba', name:'Djeba 750 ml' },
  { id:'litro', name:'Litro 1000 ml' },
  { id:'galon', name:'Galón 3800 ml' },
];

function invNum(x){
  const n = parseFloat(String(x ?? '').replace(',', '.'));
  return (typeof n === 'number' && isFinite(n)) ? n : 0;
}

function invNameFor(metaArr, id){
  const hit = (Array.isArray(metaArr) ? metaArr : []).find(x=> x && x.id === id);
  return hit && hit.name ? hit.name : String(id || '');
}

function invPct(ratio){
  if (typeof ratio !== 'number' || !isFinite(ratio)) return '';
  const p = Math.round(ratio * 100);
  if (!isFinite(p)) return '';
  return `${p}%`;
}

function readInventorySafe(){
  let raw = null;
  try{
    if (window.A33Storage && typeof A33Storage.getItem === 'function') raw = A33Storage.getItem(INV_LS_KEY);
    else raw = localStorage.getItem(INV_LS_KEY);
  }catch(_){
    raw = null;
  }
  if (!raw) return null;

  try{
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  }catch(_){
    return null;
  }
}

// --- Semáforo (acordado)
// LÍQUIDOS: rojo <=20% (o stock<=0), amarillo 20–35%, verde >35%
// BOTELLAS: rojo <=10, amarillo 11–20, verde >20
function computeLiquidsTraffic(inv){
  const src = (inv && inv.liquids && typeof inv.liquids === 'object') ? inv.liquids : {};
  const keys = new Set([...(INV_LIQUIDS_META.map(x=> x.id)), ...Object.keys(src || {})]);

  const red = [];
  const yellow = [];
  const green = [];
  const unknown = [];

  for (const id of keys){
    const row = (src && src[id]) ? src[id] : {};
    const stock = invNum(row.stock);
    const max = invNum(row.max);

    let status = null;
    let ratio = null;

    if (stock <= 0){
      status = 'red';
    } else if (max > 0){
      ratio = stock / max;
      if (ratio <= 0.20) status = 'red';
      else if (ratio <= 0.35) status = 'yellow';
      else status = 'green';
    } else {
      // Sin máximo: no inventamos porcentajes
      status = 'unknown';
    }

    const item = {
      id,
      name: invNameFor(INV_LIQUIDS_META, id) || String(id),
      stock,
      max,
      ratio,
      status
    };

    if (status === 'red') red.push(item);
    else if (status === 'yellow') yellow.push(item);
    else if (status === 'green') green.push(item);
    else unknown.push(item);
  }

  const byName = (a,b)=> String(a.name).localeCompare(String(b.name));
  red.sort(byName); yellow.sort(byName); green.sort(byName); unknown.sort(byName);

  const itemsActionable = red.concat(yellow);
  const itemsAll = red.concat(yellow, green, unknown);

  return {
    kind: 'liquids',
    red, yellow, green, unknown,
    redCount: red.length,
    yellowCount: yellow.length,
    greenCount: green.length,
    unknownCount: unknown.length,
    actionableCount: itemsActionable.length,
    totalCount: itemsAll.length,
    itemsActionable,
    itemsAll
  };
}

function computeBottlesTraffic(inv){
  const src = (inv && inv.bottles && typeof inv.bottles === 'object') ? inv.bottles : {};
  const keys = new Set([...(INV_BOTTLES_META.map(x=> x.id)), ...Object.keys(src || {})]);

  const red = [];
  const yellow = [];
  const green = [];

  for (const id of keys){
    const row = (src && src[id]) ? src[id] : {};
    const stock = invNum(row.stock);

    let status = null;
    if (stock <= 10) status = 'red';
    else if (stock <= 20) status = 'yellow';
    else status = 'green';

    const item = {
      id,
      name: invNameFor(INV_BOTTLES_META, id) || String(id),
      stock,
      status
    };

    if (status === 'red') red.push(item);
    else if (status === 'yellow') yellow.push(item);
    else green.push(item);
  }

  const byName = (a,b)=> String(a.name).localeCompare(String(b.name));
  red.sort(byName); yellow.sort(byName); green.sort(byName);

  const itemsActionable = red.concat(yellow);
  const itemsAll = red.concat(yellow, green);

  return {
    kind: 'bottles',
    red, yellow, green,
    redCount: red.length,
    yellowCount: yellow.length,
    greenCount: green.length,
    unknownCount: 0,
    actionableCount: itemsActionable.length,
    totalCount: itemsAll.length,
    itemsActionable,
    itemsAll
  };
}

function setInvSummary(sumEl, res, expanded){
  // Clear
  sumEl.innerHTML = '';

  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'cmd-inv-chips';

  const addChip = (cls, text)=>{
    const s = document.createElement('span');
    s.className = 'cmd-chip ' + cls;
    s.textContent = text;
    chipsWrap.appendChild(s);
  };

  const note = document.createElement('div');
  note.className = 'cmd-inv-note cmd-muted';

  if (!res || typeof res !== 'object'){
    addChip('cmd-chip-neutral', 'Inventario no configurado');
    note.textContent = 'Configura stocks y máximos en Inventario.';
    sumEl.appendChild(chipsWrap);
    sumEl.appendChild(note);
    return;
  }

  if (res.redCount > 0) addChip('cmd-chip-red', `Bajo ${res.redCount}`);
  if (res.yellowCount > 0) addChip('cmd-chip-yellow', `Cerca ${res.yellowCount}`);
  if (res.greenCount > 0) addChip('cmd-chip-green', `OK ${res.greenCount}`);
  if (res.kind === 'liquids' && res.unknownCount > 0) addChip('cmd-chip-neutral', `Sin máx ${res.unknownCount}`);

  if (!chipsWrap.childElementCount){
    addChip('cmd-chip-neutral', 'Sin datos');
  }

  // Nota inferior (compacta)
  if (res.actionableCount === 0){
    note.textContent = 'Todo OK';
  } else {
    const shownLimit = 5;
    if (!expanded){
      const showN = Math.min(shownLimit, res.actionableCount);
      note.textContent = (res.actionableCount > showN)
        ? `Accionables: ${res.actionableCount} · mostrando ${showN} de ${res.actionableCount}`
        : `Accionables: ${res.actionableCount}`;
    } else {
      note.textContent = `Mostrando todo · ${res.totalCount} ítem${res.totalCount === 1 ? '' : 's'}`;
    }
  }

  sumEl.appendChild(chipsWrap);
  sumEl.appendChild(note);
}

function renderInvList(listEl, res, expanded){
  listEl.innerHTML = '';

  const makeEmpty = (text, withCta)=>{
    const box = document.createElement('div');
    box.className = 'cmd-inv-empty';
    box.textContent = text || '';
    if (withCta){
      box.appendChild(document.createElement('br'));
      const a = document.createElement('a');
      a.href = INV_ROUTE;
      a.className = 'cmd-mini-btn cmd-inv-link';
      a.textContent = 'Ir a Inventario';
      box.appendChild(a);
    }
    listEl.appendChild(box);
  };

  if (!res || typeof res !== 'object'){
    makeEmpty('Inventario no configurado.', true);
    return;
  }

  // Por defecto: accionables (rojo/amarillo). Expandido: todo (incluye verde)
  const pool = expanded ? (Array.isArray(res.itemsAll) ? res.itemsAll : []) : (Array.isArray(res.itemsActionable) ? res.itemsActionable : []);

  if (!expanded && res.actionableCount === 0){
    makeEmpty('Todo OK.', false);
    return;
  }
  if (expanded && (!pool.length)){
    makeEmpty('Sin datos.', false);
    return;
  }

  const limit = expanded ? 60 : 5;
  const items = pool.slice(0, limit);

  for (const it of items){
    const row = document.createElement('div');
    row.className = 'cmd-inv-row';

    const name = document.createElement('div');
    name.className = 'cmd-inv-name';
    name.textContent = it && it.name ? String(it.name) : '—';

    const meta = document.createElement('div');
    meta.className = 'cmd-inv-meta';

    const stock = document.createElement('span');
    stock.className = 'cmd-inv-stock';

    if (res.kind === 'bottles'){
      const n = invNum((it && it.stock != null) ? it.stock : 0);
      stock.textContent = `Stock: ${n} u`;
    } else {
      const n = invNum((it && it.stock != null) ? it.stock : 0);
      const ratio = (it && typeof it.ratio === 'number' && isFinite(it.ratio)) ? it.ratio : null;
      const pct = ratio != null ? invPct(ratio) : '';
      stock.textContent = pct ? `Stock: ${n} ml · ${pct}` : `Stock: ${n} ml`;
    }

    const chip = document.createElement('span');
    const status = (it && it.status) ? String(it.status) : 'unknown';

    if (status === 'red'){
      chip.className = 'cmd-chip cmd-chip-red';
      chip.textContent = 'BAJO';
    } else if (status === 'yellow'){
      chip.className = 'cmd-chip cmd-chip-yellow';
      chip.textContent = 'CERCA';
    } else if (status === 'green'){
      chip.className = 'cmd-chip cmd-chip-green';
      chip.textContent = 'OK';
    } else {
      chip.className = 'cmd-chip cmd-chip-neutral';
      chip.textContent = 'SIN MÁX';
    }

    meta.appendChild(stock);
    meta.appendChild(chip);

    const right = document.createElement('div');
    right.className = 'cmd-inv-right';
    right.appendChild(meta);

    // Acciones rápidas SOLO en rojo/amarillo
    if (status === 'red' || status === 'yellow'){
      const acts = document.createElement('div');
      acts.className = 'cmd-inv-row-actions';

      const aView = document.createElement('a');
      aView.href = INV_ROUTE;
      aView.className = 'cmd-inv-act';
      aView.setAttribute('aria-label', 'Ver en Inventario');
      aView.textContent = '👁';
      acts.appendChild(aView);

      if (calcRouteAvailable){
        const aFab = document.createElement('a');
        aFab.href = CALC_ROUTE;
        aFab.className = 'cmd-inv-act';
        aFab.setAttribute('aria-label', 'Ir a Calculadora (Fabricar)');
        aFab.textContent = '⚗️';
        acts.appendChild(aFab);
      }

      right.appendChild(acts);
    }

    row.appendChild(name);
    row.appendChild(right);

    listEl.appendChild(row);
  }

  if (!expanded && res.actionableCount > limit){
    const more = document.createElement('div');
    more.className = 'cmd-inv-empty';
    more.textContent = `+ ${res.actionableCount - limit} más…`;
    listEl.appendChild(more);
  }
}

function renderInvRiskCard(listId, summaryId, toggleId, res, expanded){
  const listEl = $(listId);
  const sumEl = $(summaryId);
  const togEl = $(toggleId);
  if (!listEl || !sumEl) return;

  if (togEl){
    togEl.textContent = expanded ? 'Ocultar' : 'Ver todo';
    togEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  setInvSummary(sumEl, res, expanded);
  renderInvList(listEl, res, expanded);
}

function renderInvRiskBlock(liquidsRes, bottlesRes){
  if (!$('invRiskBlock')) return;

  renderInvRiskCard(
    'invRiskLiquidsList',
    'invRiskLiquidsSummary',
    'invLiquidsToggle',
    liquidsRes,
    !!invViewState.liquidsExpanded
  );

  renderInvRiskCard(
    'invRiskBottlesList',
    'invRiskBottlesSummary',
    'invBottlesToggle',
    bottlesRes,
    !!invViewState.bottlesExpanded
  );
}

function refreshInvRiskBlock(){
  if (!$('invRiskBlock')) return;

  const inv = readInventorySafe();
  if (!inv){
    renderInvRiskBlock(null, null);
    setInvRiskUpdatedAt(new Date());
    return;
  }

  const liq = computeLiquidsTraffic(inv);
  const bot = computeBottlesTraffic(inv);

  renderInvRiskBlock(liq, bot);
  setInvRiskUpdatedAt(new Date());
}


// --- DOM helpers

const $ = (id)=> document.getElementById(id);

function fmtHHMM(dt){
  try{
    const d = dt instanceof Date ? dt : new Date();
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  }catch(_){
    return '--:--';
  }
}

function setInvRiskUpdatedAt(dt){
  const el = $('invRiskUpdatedAt');
  if (!el) return;
  el.textContent = fmtHHMM(dt);
}

async function checkRouteExists(url){
  // Evitar falsos negativos en modo offline: si falla el fetch, asumimos que existe.
  try{
    const res = await fetch(url, { method:'GET', cache:'no-cache' });
    return !!(res && res.ok);
  }catch(_){
    return true;
  }
}

async function probeCalcRoute(){
  try{
    const ok = await checkRouteExists(CALC_ROUTE);
    calcRouteAvailable = !!ok;
    // Rerender para mostrar/ocultar acción "Fabricar"
    refreshInvRiskBlock();
  }catch(_){ }
}

function todayYMD(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function ymdAddDays(ymd, delta){
  try{
    const [y,m,d] = ymd.split('-').map(n=>parseInt(n,10));
    const dt = new Date(y, (m||1)-1, d||1);
    dt.setDate(dt.getDate() + delta);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth()+1).padStart(2,'0');
    const dd = String(dt.getDate()).padStart(2,'0');
    return `${yy}-${mm}-${dd}`;
  }catch(_){
    return ymd;
  }
}


function fmtYMDShortES(ymd){
  // Ej: 2026-01-05 -> "Lun 05 Ene"
  try{
    const [y,m,d] = String(ymd).split('-').map(n=>parseInt(n,10));
    const dt = new Date(y, (m||1)-1, d||1);
    const dow = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][dt.getDay()] || '—';
    const mon = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][dt.getMonth()] || '—';
    const dd = String(dt.getDate()).padStart(2,'0');
    return `${dow} ${dd} ${mon}`;
  }catch(_){
    return String(ymd || '');
  }
}

function fmtMoneyNIO(n){
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  // 2 decimales, sin locales raros (consistencia iPad)
  const s = n.toFixed(2);
  // separador de miles simple
  const parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `C$ ${parts.join('.')}`;
}

function safeStr(x){
  const s = (x == null) ? '' : String(x);
  return s.trim();
}

// --- Preferencias UI (Recordatorios)
function getShowDoneRemindersPref(){
  try{
    const raw = localStorage.getItem(REMINDERS_SHOW_DONE_KEY);
    return raw === '1' || raw === 'true';
  }catch(_){
    return false;
  }
}

function setShowDoneRemindersPref(val){
  try{ localStorage.setItem(REMINDERS_SHOW_DONE_KEY, val ? '1' : '0'); }catch(_){ }
}


// --- Recomendaciones (Analítica: cache)
function safeLSGetJSON(key, fallback=null){
  try{
    if (window.A33Storage && typeof A33Storage.getJSON === 'function') return A33Storage.getJSON(key, fallback);
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  }catch(_){
    return fallback;
  }
}

function resolveAnalyticsLink(actionLink){
  const s = safeStr(actionLink);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('?') || s.startsWith('#')) return ANALYTICS_ROUTE + s;
  if (s.startsWith('./')) return '../analitica/' + s.slice(2);
  if (/^index\.html/i.test(s)) return '../analitica/' + s;
  if (s.startsWith('analitica/')) return '../' + s;
  if (s.startsWith('/')) return s;
  // default: asumir ruta dentro de Analítica
  return '../analitica/' + s.replace(/^\.\//,'');
}

function parseRecoUpdatedAt(items){
  // Preferir updatedAt del primer item (Analítica escribe el mismo para todos)
  try{
    const ts = items && items[0] && items[0].updatedAt ? Date.parse(items[0].updatedAt) : 0;
    if (ts && isFinite(ts)) return new Date(ts);
  }catch(_){ }
  // fallback: buscar el primero válido
  for (const it of (Array.isArray(items) ? items : [])){
    try{
      const t = it && it.updatedAt ? Date.parse(it.updatedAt) : 0;
      if (t && isFinite(t)) return new Date(t);
    }catch(_){ }
  }
  return null;
}

function readAnalyticsRecos(){
  const raw = safeLSGetJSON(ANALYTICS_RECOS_KEY, null);
  let items = [];
  if (Array.isArray(raw)) items = raw;
  else if (raw && typeof raw === 'object' && Array.isArray(raw.items)) items = raw.items;
  items = (Array.isArray(items) ? items : []).filter(x=> x && typeof x === 'object').slice(0, 5);
  const updatedAt = parseRecoUpdatedAt(items);
  return { items, updatedAt };
}

function recoTypeClass(type){
  const t = safeStr(type).toLowerCase();
  if (!t) return 'cmd-chip-neutral';
  if (t.includes('dorm') || t.includes('react')) return 'cmd-chip-red';
  if (t.includes('margen') || t.includes('top') || t.includes('upsell') || t.includes('cross')) return 'cmd-chip-yellow';
  return 'cmd-chip-neutral';
}

function renderRecos(){
  const list = $('recosList');
  const empty = $('recosEmpty');
  const updated = $('recosUpdatedAt');
  if (!list || !empty || !updated) return;

  const { items, updatedAt } = readAnalyticsRecos();

  if (!Array.isArray(items) || items.length === 0){
    list.innerHTML = '';
    empty.hidden = false;
    updated.textContent = '--:--';
    return;
  }

  empty.hidden = true;
  updated.textContent = updatedAt ? fmtHHMM(updatedAt) : '--:--';

  list.innerHTML = '';
  for (const it of items){
    const row = document.createElement('div');
    row.className = 'cmd-reco-item';

    const main = document.createElement('div');
    main.className = 'cmd-reco-main';

    const top = document.createElement('div');
    top.className = 'cmd-reco-top';

    const chip = document.createElement('span');
    chip.className = 'cmd-chip ' + recoTypeClass(it.type);
    chip.textContent = safeStr(it.type) ? safeStr(it.type).replace(/_/g,' ') : 'reco';

    const title = document.createElement('div');
    title.className = 'cmd-reco-title';
    title.textContent = safeStr(it.title) || 'Recomendación';

    top.appendChild(chip);
    top.appendChild(title);

    const reason = document.createElement('div');
    reason.className = 'cmd-reco-reason cmd-muted';
    reason.textContent = safeStr(it.reason) || '';

    main.appendChild(top);
    if (reason.textContent) main.appendChild(reason);

    const actions = document.createElement('div');
    actions.className = 'cmd-reco-actions';

    const link = resolveAnalyticsLink(it.actionLink);
    const btnView = document.createElement('button');
    btnView.className = 'cmd-mini-btn';
    btnView.type = 'button';
    btnView.textContent = 'Ver';
    btnView.disabled = !link;
    if (link){
      btnView.addEventListener('click', ()=>{
        try{ window.location.href = link; }catch(_){ }
      });
    }
    actions.appendChild(btnView);

    const copyText = safeStr(it.copyText || it.text || it.suggestedText);
    if (copyText){
      const btnCopy = document.createElement('button');
      btnCopy.className = 'cmd-mini-btn';
      btnCopy.type = 'button';
      btnCopy.textContent = 'Copiar';
      btnCopy.addEventListener('click', async ()=>{
        try{
          await navigator.clipboard.writeText(copyText);
          showToast('Copiado ✅', 1200);
        }catch(_){
          showToast('No se pudo copiar', 1400);
        }
      });
      actions.appendChild(btnCopy);
    }

    row.appendChild(main);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

async function recalcRecos(){
  const btn = $('recosRecalcBtn');
  if (btn) btn.disabled = true;

  // Si existe un método global de Analítica, úsalo. Si no, mínimo re-lee el cache.
  const callers = [
    ()=> (window.A33Analytics && typeof A33Analytics.recalcRecommendations === 'function') ? A33Analytics.recalcRecommendations() : null,
    ()=> (window.A33Analytics && typeof A33Analytics.recalcRecos === 'function') ? A33Analytics.recalcRecos() : null,
    ()=> (window.Analytics && typeof Analytics.recalcRecommendations === 'function') ? Analytics.recalcRecommendations() : null,
    ()=> (typeof window.A33AnalyticsRecalcRecos === 'function') ? window.A33AnalyticsRecalcRecos() : null,
  ];

  let invoked = false;
  for (const fn of callers){
    try{
      const out = fn();
      if (out != null){
        invoked = true;
        await Promise.resolve(out);
        break;
      }
    }catch(_){ }
  }

  renderRecos();
  const { items } = readAnalyticsRecos();
  if (!items.length){
    showToast(invoked ? 'Sin recomendaciones aún. Abre Analítica.' : 'No hay cache. Abre Analítica.', 1700);
  } else {
    showToast('Recomendaciones actualizadas', 1400);
  }

  if (btn) btn.disabled = false;
}

function uniq(arr){
  const out = [];
  const s = new Set();
  for (const it of (Array.isArray(arr) ? arr : [])){
    const k = String(it);
    if (s.has(k)) continue;
    s.add(k);
    out.push(it);
  }
  return out;
}

// --- IDB helpers (robustos)
async function openPosDB(opts){
  const timeoutMs = (opts && opts.timeoutMs) ? opts.timeoutMs : 3500;

  return new Promise((resolve, reject)=>{
    let done = false;
    let req;
    const fail = (err)=>{
      if (done) return;
      done = true;
      reject(err instanceof Error ? err : new Error(String(err || 'Error abriendo IndexedDB')));
    };
    const ok = (db)=>{
      if (done) return;
      done = true;
      resolve(db);
    };

    const t = setTimeout(()=>{
      // No bloquea la suite: fallamos y mostramos “No disponible”
      fail(new Error('Timeout abriendo IndexedDB del POS'));
    }, timeoutMs);

    try{
      req = indexedDB.open(POS_DB_NAME);
    }catch(err){
      clearTimeout(t);
      fail(err);
      return;
    }

    req.onerror = ()=>{ clearTimeout(t); fail(req.error || new Error('IndexedDB error')); };
    req.onblocked = ()=>{
      // No es fatal, pero suele indicar otro tab viejo abierto.
      console.warn('Centro de Mando: open blocked. Cierra otras pestañas de Suite A33.');
    };
    req.onsuccess = ()=>{
      clearTimeout(t);
      const db = req.result;
      try{
        db.onversionchange = ()=>{
          try{ db.close(); }catch(_){ }
        };
      }catch(_){ }
      ok(db);
    };
  });
}

function hasStore(db, name){
  try{
    return !!(db && db.objectStoreNames && db.objectStoreNames.contains(name));
  }catch(_){
    return false;
  }
}

function tx(db, storeName, mode){
  return db.transaction(storeName, mode || 'readonly').objectStore(storeName);
}

async function idbGet(db, storeName, key){
  if (!db || !hasStore(db, storeName)) return null;
  return new Promise((resolve)=>{
    try{
      const req = tx(db, storeName, 'readonly').get(key);
      req.onsuccess = ()=> resolve(req.result ?? null);
      req.onerror = ()=>{ console.warn('idbGet error', storeName, req.error); resolve(null); };
    }catch(err){
      console.warn('idbGet exception', storeName, err);
      resolve(null);
    }
  });
}

async function idbPut(db, storeName, value){
  if (!db || !hasStore(db, storeName)) return false;
  return new Promise((resolve)=>{
    try{
      const tr = db.transaction(storeName, 'readwrite');
      tr.oncomplete = ()=> resolve(true);
      tr.onerror = ()=>{ console.warn('idbPut tx error', storeName, tr.error); resolve(false); };
      tr.onabort = ()=>{ console.warn('idbPut tx abort', storeName, tr.error); resolve(false); };
      tr.objectStore(storeName).put(value);
    }catch(err){
      console.warn('idbPut exception', storeName, err);
      resolve(false);
    }
  });
}

async function idbGetAll(db, storeName){
  if (!db || !hasStore(db, storeName)) return [];
  return new Promise((resolve)=>{
    try{
      const req = tx(db, storeName, 'readonly').getAll();
      req.onsuccess = ()=> resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = ()=>{ console.warn('idbGetAll error', storeName, req.error); resolve([]); };
    }catch(err){
      console.warn('idbGetAll exception', storeName, err);
      resolve([]);
    }
  });
}

async function idbGetAllByIndex(db, storeName, indexName, keyRange){
  if (!db || !hasStore(db, storeName)) return null;
  return new Promise((resolve)=>{
    try{
      const store = tx(db, storeName, 'readonly');
      if (!store.indexNames || !store.indexNames.contains(indexName)) return resolve(null);
      const idx = store.index(indexName);
      const req = idx.getAll(keyRange);
      req.onsuccess = ()=> resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = ()=>{ console.warn('idbGetAllByIndex error', storeName, indexName, req.error); resolve(null); };
    }catch(err){
      console.warn('idbGetAllByIndex exception', storeName, indexName, err);
      resolve(null);
    }
  });
}

async function idbCountByIndex(db, storeName, indexName, keyRange){
  if (!db || !hasStore(db, storeName)) return null;
  return new Promise((resolve)=>{
    try{
      const store = tx(db, storeName, 'readonly');
      if (!store.indexNames || !store.indexNames.contains(indexName)) return resolve(null);
      const idx = store.index(indexName);
      const req = idx.count(keyRange);
      req.onsuccess = ()=> resolve(typeof req.result === 'number' ? req.result : null);
      req.onerror = ()=>{ console.warn('idbCountByIndex error', storeName, indexName, req.error); resolve(null); };
    }catch(err){
      console.warn('idbCountByIndex exception', storeName, indexName, err);
      resolve(null);
    }
  });
}

// --- POS meta helpers
async function getMeta(db, key){
  const row = await idbGet(db, 'meta', key);
  return row ? row.value : null;
}

async function setMeta(db, key, value){
  return idbPut(db, 'meta', { id: key, value });
}


// --- Recordatorios (posRemindersIndex) — SOLO lectura
function remindersGetShowDone(){
  try{
    const raw = localStorage.getItem(REMINDERS_SHOW_DONE_KEY);
    return raw === '1' || raw === 'true';
  }catch(_){
    return false;
  }
}

function remindersSetShowDone(v){
  try{ localStorage.setItem(REMINDERS_SHOW_DONE_KEY, v ? '1' : '0'); }catch(_){ }
}

function remindersDueMinutes(row){
  const t = safeStr(row && row.dueTime);
  if (!/^[0-2]\d:[0-5]\d$/.test(t)) return 1e9;
  const [hh, mm] = t.split(':').map(n=>parseInt(n,10));
  if (!isFinite(hh) || !isFinite(mm)) return 1e9;
  return (hh * 60) + mm;
}

function remindersPriorityRank(p){
  const s = safeStr(p).toLowerCase();
  if (s === 'high') return 0;
  if (s === 'med') return 1;
  if (s === 'low') return 2;
  return 3;
}

async function idbScanRemindersByDayPrefix(db, dayKey){
  if (!db || !hasStore(db, REMINDERS_STORE)) return [];
  const prefix = `${String(dayKey)}|`;
  return new Promise((resolve)=>{
    try{
      const store = tx(db, REMINDERS_STORE, 'readonly');
      let range = null;
      try{
        range = IDBKeyRange.bound(prefix, prefix + '\uffff');
      }catch(_){
        range = null;
      }

      const out = [];
      const req = store.openCursor(range);
      req.onsuccess = (e)=>{
        const cur = e.target.result;
        if (!cur) return resolve(out);
        if (out.length >= 1200) return resolve(out); // seguridad
        out.push(cur.value);
        try{ cur.continue(); }catch(_){ resolve(out); }
      };
      req.onerror = ()=> resolve([]);
    }catch(err){
      console.warn('idbScanRemindersByDayPrefix exception', err);
      resolve([]);
    }
  });
}

async function readRemindersIndexForDay(db, dayKey){
  if (!db) return { ok:false, rows:[], reason:'No disponible' };
  if (!hasStore(db, REMINDERS_STORE)) {
    return { ok:false, rows:[], reason:'Índice no disponible. Abre POS una vez.' };
  }

  let rows = null;
  try{
    rows = await idbGetAllByIndex(db, REMINDERS_STORE, 'by_day', IDBKeyRange.only(String(dayKey)));
  }catch(_){
    rows = null;
  }
  if (rows === null){
    // Fallback eficiente por prefijo de clave (dayKey|...)
    rows = await idbScanRemindersByDayPrefix(db, String(dayKey));
  }
  if (!Array.isArray(rows)) rows = [];
  return { ok:true, rows, reason:'' };
}


async function readRemindersIndexForRange(db, dayKeys){
  const keys = Array.isArray(dayKeys) ? dayKeys.map(k=>String(k)) : [];
  if (!db) return { ok:false, rows:[], reason:'No disponible', dayKeys: keys };
  if (!hasStore(db, REMINDERS_STORE)) {
    return { ok:false, rows:[], reason:'Índice no disponible. Abre POS una vez.', dayKeys: keys };
  }

  const rowsAll = [];
  let anyOk = false;
  for (const dk of keys){
    try{
      const res = await readRemindersIndexForDay(db, dk);
      if (res && res.ok){
        anyOk = true;
        if (Array.isArray(res.rows) && res.rows.length) rowsAll.push(...res.rows);
      }
    }catch(_){
      // seguimos con el resto de días
    }
  }

  return { ok:anyOk, rows: rowsAll, reason: anyOk ? '' : 'No disponible', dayKeys: keys };
}

function renderRemindersBlock(payload){
  const pendingEl = $('remindersPending');
  const listEl = $('remindersList');
  const emptyEl = $('remindersEmpty');
  const emptyHint = $('remindersEmptyHint');
  const toggleEl = $('remindersToggleDone');

  // Título: "Recordatorios · Próximos 7 días" (manteniendo el contador existente)
  try{
    const titleEl = document.querySelector('#remindersBlock .cmd-rem-card .cmd-section-title');
    if (titleEl){
      const span = titleEl.querySelector('span');
      // reconstruimos el título sin tocar el span (contiene #remindersPending)
      if (span){
        titleEl.innerHTML = '';
        titleEl.appendChild(document.createTextNode('Recordatorios · Próximos 7 días '));
        titleEl.appendChild(span);
      }
    }
  }catch(_){ }

  const showDonePref = remindersGetShowDone();
  if (toggleEl){
    toggleEl.setAttribute('aria-pressed', showDonePref ? 'true' : 'false');
    toggleEl.textContent = showDonePref ? 'Ocultar completados' : 'Mostrar completados';
  }

  if (listEl) listEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = true;

  const ok = payload && payload.ok;
  const rows = ok && Array.isArray(payload.rows) ? payload.rows : [];
  const reason = payload && payload.reason ? String(payload.reason) : '';
  const dayKeys = (payload && Array.isArray(payload.dayKeys) && payload.dayKeys.length)
    ? payload.dayKeys.map(k=>String(k))
    : Array.from(new Set(rows.map(r=> safeStr(r && r.dayKey)).filter(Boolean))).sort();

  // Pendientes: siempre basado en done=false (en TODO el rango)
  const pendingCount = rows.filter(r => !(r && r.done)).length;
  if (pendingEl) pendingEl.textContent = String(pendingCount);

  if (!ok){
    if (emptyEl) emptyEl.hidden = false;
    if (emptyHint) emptyHint.textContent = reason || 'No disponible';
    return;
  }

  // Agrupar por dayKey
  const byDay = new Map();
  for (const r of rows){
    if (!r || typeof r !== 'object') continue;
    const dk = safeStr(r.dayKey);
    if (!dk) continue;
    if (!byDay.has(dk)) byDay.set(dk, []);
    byDay.get(dk).push(r);
  }

  // Orden: dueTime asc (sin hora al final), prioridad high>med>low, updatedAt desc
  const sortRows = (arr)=>{
    arr.sort((a,b)=>{
      const ad = remindersDueMinutes(a);
      const bd = remindersDueMinutes(b);
      if (ad !== bd) return ad - bd;
      const ap = remindersPriorityRank(a && a.priority);
      const bp = remindersPriorityRank(b && b.priority);
      if (ap !== bp) return ap - bp;
      const au = Number((a && (a.updatedAt || a.createdAt)) || 0);
      const bu = Number((b && (b.updatedAt || b.createdAt)) || 0);
      if (au !== bu) return bu - au;
      return safeStr(a && a.idxId).localeCompare(safeStr(b && b.idxId));
    });
  };

  const renderRow = (r)=>{
    const wrap = document.createElement('div');
    wrap.className = 'cmd-rem-item';

    const top = document.createElement('div');
    top.className = 'cmd-rem-top';

    const evName = safeStr(r.eventName) || (r.eventId != null ? (`Evento #${r.eventId}`) : 'Evento —');
    const ev = document.createElement('div');
    ev.className = 'cmd-rem-event';
    ev.textContent = evName;

    const chips = document.createElement('div');
    chips.className = 'cmd-rem-chips';

    const addChip = (cls, text)=>{
      const s = document.createElement('span');
      s.className = 'cmd-chip ' + cls;
      s.textContent = text;
      chips.appendChild(s);
    };

    const due = safeStr(r.dueTime);
    if (due) addChip('cmd-chip-neutral', due);

    const pr = safeStr(r.priority).toLowerCase();
    if (pr === 'high') addChip('cmd-chip-critical', 'Alta');
    else if (pr === 'med') addChip('cmd-chip-yellow', 'Media');
    else if (pr === 'low') addChip('cmd-chip-low', 'Baja');

    const done = !!r.done;
    addChip(done ? 'cmd-chip-green' : 'cmd-chip-neutral', done ? 'Hecho' : 'Pendiente');

    top.appendChild(ev);
    top.appendChild(chips);

    const text = document.createElement('div');
    text.className = 'cmd-rem-text';
    text.textContent = safeStr(r.text) || '—';

    wrap.appendChild(top);
    wrap.appendChild(text);
    if (listEl) listEl.appendChild(wrap);
  };

  let shownTotal = 0;
  for (const dk of dayKeys){
    const allDay = byDay.get(dk) || [];
    const shownDay = showDonePref ? allDay.slice() : allDay.filter(r => !(r && r.done));
    sortRows(shownDay);
    if (!shownDay.length) continue;

    shownTotal += shownDay.length;

    // Header por fecha
    const h = document.createElement('div');
    h.className = 'cmd-rem-day-title';
    h.textContent = `${fmtYMDShortES(dk)} · ${dk}`;
    if (listEl) listEl.appendChild(h);

    for (const r of shownDay) renderRow(r);
  }

  if (!shownTotal){
    if (emptyEl) emptyEl.hidden = false;
    if (emptyHint) emptyHint.textContent = showDonePref
      ? 'No hay recordatorios para los próximos 7 días.'
      : 'No hay pendientes para los próximos 7 días.';
    return;
  }
}



async function refreshRemindersNext7(){
  try{
    const start = state && state.today ? String(state.today) : todayYMD();
    const dayKeys = [];
    for (let i=0; i<7; i++) dayKeys.push(ymdAddDays(start, i));
    const rem = await readRemindersIndexForRange(state.db, dayKeys);
    renderRemindersBlock(rem);
  }catch(_){
    renderRemindersBlock({ ok:false, rows:[], reason:'No disponible', dayKeys:[] });
  }
}
// --- Checklist helpers (estructura real en POS: ev.checklistTemplate + ev.days[YYYY-MM-DD].checklistState)
function computeChecklistProgress(ev, dayKey){
  if (!ev || typeof ev !== 'object') return { ok:false, text:'—', checked:null, total:null, reason:'No disponible' };

  const tpl = (ev.checklistTemplate && typeof ev.checklistTemplate === 'object') ? ev.checklistTemplate : null;
  if (!tpl) return { ok:false, text:'—', checked:null, total:null, reason:'No disponible' };

  const arr = (x)=> Array.isArray(x) ? x : [];
  const total = arr(tpl.pre).length + arr(tpl.evento).length + arr(tpl.cierre).length;
  if (!(total > 0)) return { ok:false, text:'—', checked:0, total:0, reason:'Sin plantilla' };

  const day = (ev.days && typeof ev.days === 'object') ? ev.days[dayKey] : null;
  const st = (day && day.checklistState && typeof day.checklistState === 'object') ? day.checklistState : null;
  const checkedIds = st ? uniq(st.checkedIds) : [];
  const checked = checkedIds.length;
  return { ok:true, text:`${checked}/${total}`, checked, total, reason:'' };
}

function hasPettyDayActivity(day){
  if (!day || typeof day !== 'object') return false;
  if (day.initial && day.initial.savedAt) return true;
  if (day.finalCount && day.finalCount.savedAt) return true;
  if (Array.isArray(day.movements) && day.movements.length) return true;
  if (day.fxRate != null) return true;
  return false;
}

// --- State
const state = {
  db: null,
  events: [],
  eventsById: new Map(),
  focusId: null,
  focusEvent: null,
  today: todayYMD(),
  currentAlerts: [],
};

// --- UI render
function setText(id, text){
  const el = $(id);
  if (!el) return;
  el.textContent = (text == null || text === '') ? '—' : String(text);
}

function setHidden(id, hidden){
  const el = $(id);
  if (!el) return;
  el.hidden = !!hidden;
}

function setDisabled(id, disabled){
  const el = $(id);
  if (!el) return;
  el.disabled = !!disabled;
}

function renderRadarBasics(){
  setText('radarEvents', state.events.length ? String(state.events.length) : (state.db ? '0' : '—'));
  setText('radarEventName', state.focusEvent ? (safeStr(state.focusEvent.name) || '—') : '—');
  // productos sin stock: intencionalmente “—” (cálculo no trivial)
  setText('radarNoStock', '—');
}

function renderFocusHint(){
  const ev = state.focusEvent;
  if (!ev){
    setText('focusHint', '—');
    setText('navNote', 'Selecciona un evento para habilitar navegación contextual.');
    return;
  }
  const g = safeStr(ev.groupName);
  const created = safeStr(ev.createdAt);
  const parts = [];
  if (g) parts.push(`Grupo: ${g}`);
  if (created) parts.push(`Creado: ${created.slice(0,10)}`);
  setText('focusHint', parts.length ? parts.join(' · ') : 'Evento listo.');
  setText('navNote', `Navegación enfocada en: ${safeStr(ev.name) || '—'}`);
}

function renderEmpty(){
  setHidden('emptyState', state.events.length > 0);
  // si no hay eventos, escondemos el resto para no mostrar “—” por todos lados
  setHidden('todayPanel', state.events.length === 0);
  setHidden('alerts', true);
}

function clearMetricsToDash(){
  setText('salesToday', '—');
  setText('salesTodaySub', '—');
  setText('salesTodayHint', 'No disponible');
  setText('pettyState', '—');
  setText('pettyDayState', '—');
  setText('pettyHint', 'No disponible');
  setText('checklistProgress', '—');
  setText('checklistHint', 'No disponible');
  setText('topProducts', '—');
  setText('topHint', '—');
  setText('topProductsHint', 'No disponible');
  setText('radarUnclosed', '—');
}

function renderAlerts(alerts){
  const wrap = $('alerts');
  const list = $('alertList');
  if (!wrap || !list) return;

  // null => ocultar completamente el bloque
  if (alerts === null){
    wrap.hidden = true;
    list.innerHTML = '';
    state.currentAlerts = [];
    return;
  }

  const arr = Array.isArray(alerts) ? alerts : [];
  // snapshot en memoria (para diff en "Sincronizar")
  state.currentAlerts = arr.map(a=> (a && typeof a === 'object') ? ({...a}) : a);

  // Si no hay nada que atender, ocultar el bloque (evita ruido visual)
  if (!arr.length){
    wrap.hidden = true;
    list.innerHTML = '';
    return;
  }

  list.innerHTML = '';
  wrap.hidden = false;

  for (const a of arr){
    const row = document.createElement('div');
    row.className = 'cmd-alert';
    if (a && a.key) row.dataset.key = String(a.key);

    const ic = document.createElement('div');
    ic.className = 'cmd-alert-ic';
    ic.textContent = (a && a.icon != null) ? String(a.icon) : '';

    const main = document.createElement('div');
    main.className = 'cmd-alert-main';

    const title = document.createElement('div');
    title.className = 'cmd-alert-title';
    title.textContent = (a && a.title != null) ? String(a.title) : '—';

    const sub = document.createElement('div');
    sub.className = 'cmd-alert-sub';
    sub.textContent = (a && a.sub != null) ? String(a.sub) : '';

    main.appendChild(title);
    main.appendChild(sub);

    const btn = document.createElement('button');
    btn.className = 'cmd-btn';
    btn.type = 'button';
    btn.textContent = (a && a.cta) ? String(a.cta) : 'Ver';

    if (a && a.go === 'pedidos'){
      btn.addEventListener('click', navigateToPedidos);
    } else if (a && a.tab){
      btn.addEventListener('click', ()=> navigateToPOS(a.tab));
    } else if (a && a.href){
      btn.addEventListener('click', ()=> { try{ window.location.href = String(a.href); }catch(_){ } });
    } else {
      btn.disabled = true;
    }

    row.appendChild(ic);
    row.appendChild(main);
    row.appendChild(btn);

    list.appendChild(row);
  }
}

function renderTop3(items){
  const el = $('topProducts');
  if (!el) return;
  if (!Array.isArray(items) || !items.length){
    el.textContent = '—';
    return;
  }
  el.innerHTML = '';
  items.slice(0,3).forEach((it, idx)=>{
    const span = document.createElement('span');
    span.textContent = `${idx+1}. ${it.name} · ${it.qty}`;
    el.appendChild(span);
  });
}


// --- Pedidos (operativo, fuente real: localStorage/A33Storage -> arcano33_pedidos)
function normalizeYMD(s){
  const v = (s == null) ? '' : String(s).trim();
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) ? v : '';
}

function loadPedidosSafe(){
  try{
    const storage = (typeof A33Storage !== 'undefined' && A33Storage && typeof A33Storage.getItem === 'function')
      ? A33Storage
      : null;

    const raw = storage ? storage.getItem(ORDERS_LS_KEY) : localStorage.getItem(ORDERS_LS_KEY);
    if (!raw) return { ok:true, items:[], reason:'' };

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok:false, items:[], reason:'No disponible' };

    return { ok:true, items: parsed, reason:'' };
  }catch(err){
    console.warn('Centro de Mando: error leyendo pedidos', err);
    return { ok:false, items:[], reason:'No disponible' };
  }
}

function normalizePedido(p){
  const id = (p && p.id != null) ? String(p.id) : '';
  const cliente = (p && p.clienteNombre != null) ? String(p.clienteNombre) : '—';
  const entrega = normalizeYMD(p && p.fechaEntrega);
  const fab = normalizeYMD(p && (p.fechaFabricacion || p.fechaFabricación || p.fechaCreacion)); // usa fechaCreacion como fabricación por compatibilidad
  const cre = normalizeYMD(p && p.fechaCreacion);
  return { id, cliente, entrega, fab, cre, raw:p };
}

function computeOrdersOperative(){
  const res = loadPedidosSafe();
  const today = state.today;
  const tomorrow = ymdAddDays(today, 1);

  const unavailable = [];
  const alerts = [];

  if (!res.ok){
    unavailable.push({ key:'orders', label:'Pedidos', reason: res.reason || 'No disponible' });
    return {
      ok:false,
      reason: res.reason || 'No disponible',
      today, tomorrow,
      pendingCount: null,
      topToday: [],
      topTomorrow: [],
      tomorrowShow: false,
      tomorrowMake: null,
      tomorrowDeliver: null,
      alerts,
      unavailable,
      hasFabField: false,
    };
  }

  const all = Array.isArray(res.items) ? res.items.slice(0, SAFE_SCAN_LIMIT) : [];
  const pending = [];
  let skippedUnknownStatus = 0;

  for (const o of all){
    if (!o || typeof o !== 'object') continue;

    if (typeof o.entregado !== 'boolean'){
      skippedUnknownStatus += 1;
      continue;
    }
    if (o.entregado === false){
      pending.push(normalizePedido(o));
    }
  }

  const hasFabField = pending.some(x=> !!x.fab);

  // Conteos por fecha de entrega
  const deliverToday = pending.filter(x=> x.entrega && x.entrega === today);
  const overdue = pending.filter(x=> x.entrega && x.entrega < today);

  // Producción (solo si existe fab real)
  const makeToday = hasFabField ? pending.filter(x=> x.fab && x.fab === today) : [];

  // Mañana
  const deliverTomorrow = pending.filter(x=> x.entrega && x.entrega === tomorrow);
  const makeTomorrow = hasFabField ? pending.filter(x=> x.fab && x.fab === tomorrow) : [];

  // Alerts (solo con señal real)
  if (deliverToday.length){
    alerts.push({
      key: 'orders-deliver-today',
      icon: '📦',
      title: `Entregas hoy: ${deliverToday.length}`,
      sub: `Entrega hoy (${today}) · Pendientes`,
      cta: 'Ver Pedidos',
      go: 'pedidos'
    });
  }
  if (overdue.length){
    alerts.push({
      key: 'orders-overdue',
      icon: '⏰',
      title: `Entregas vencidas: ${overdue.length}`,
      sub: `Pendientes con entrega antes de hoy (${today})`,
      cta: 'Ver Pedidos',
      go: 'pedidos'
    });
  }

  if (makeToday.length){
    const top3 = makeToday.slice(0, 3);
    const extra = Math.max(0, makeToday.length - top3.length);

    top3.forEach((x, idx)=>{
      const tail = (idx === top3.length - 1 && extra) ? ` · +${extra} más` : '';
      alerts.push({
        key: `orders-make-today:${x.id || String(idx)}`,
        icon: '🧪',
        title: `Hacer sangría hoy: ${x.cliente}`,
        sub: `Fab: ${x.fab || '—'} · Ent: ${x.entrega || '—'}${tail}`,
        cta: 'Ver Pedidos',
        go: 'pedidos'
      });
    });
  }

  // Sort helpers
  const MAX = '9999-99-99';
  const sortGeneral = (a,b)=>{
    const ae = a.entrega || MAX;
    const be = b.entrega || MAX;
    if (ae !== be) return ae.localeCompare(be);
    const af = a.fab || MAX;
    const bf = b.fab || MAX;
    if (af !== bf) return af.localeCompare(bf);
    const ac = a.cre || MAX;
    const bc = b.cre || MAX;
    if (ac !== bc) return ac.localeCompare(bc);
    return String(a.id || '').localeCompare(String(b.id || ''));
  };

  const topToday = pending.slice().sort(sortGeneral).slice(0, 5);

  // Tomorrow top: priorizar entregar mañana, luego fabricar mañana
  const tomorrowSubset = pending.filter(x=> (x.entrega === tomorrow) || (hasFabField && x.fab === tomorrow));
  const sortTomorrow = (a,b)=>{
    const ap = (a.entrega === tomorrow) ? 0 : 1;
    const bp = (b.entrega === tomorrow) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return sortGeneral(a,b);
  };
  const topTomorrow = tomorrowSubset.slice().sort(sortTomorrow).slice(0, 5);

  const tomorrowShow = (deliverTomorrow.length > 0) || (hasFabField && makeTomorrow.length > 0);

  // Nota: si hay pedidos con estado desconocido, no inventar conteo total
  const pendingCount = (skippedUnknownStatus > 0) ? null : pending.length;

  const tomorrowMakeVal = hasFabField ? makeTomorrow.length : null;
  const tomorrowDeliverVal = deliverTomorrow.length;

  return {
    ok:true,
    reason:'',
    today, tomorrow,
    pendingCount,
    topToday,
    topTomorrow,
    tomorrowShow,
    tomorrowMake: tomorrowMakeVal,
    tomorrowDeliver: tomorrowDeliverVal,
    alerts,
    unavailable,
    hasFabField,
    skippedUnknownStatus
  };
}

function clearOrdersToDash(){
  setText('ordersPending', 'Pendientes: —');
  setText('ordersTodayHint', 'No disponible');
  const elToday = $('ordersTopToday');
  if (elToday) elToday.innerHTML = '';
  const cardT = $('ordersTomorrowCard');
  if (cardT) cardT.hidden = true;
  setText('ordersTomorrowDate', '—');
  setText('tomorrowMake', '—');
  setText('tomorrowDeliver', '—');
  const elTom = $('ordersTopTomorrow');
  if (elTom) elTom.innerHTML = '';
}

function renderOrdersOperative(ctx){
  if (!ctx || typeof ctx !== 'object'){
    clearOrdersToDash();
    return { alerts: [], unavailable: [{ key:'orders', label:'Pedidos', reason:'No disponible' }] };
  }

  const listToday = $('ordersTopToday');
  const listTom = $('ordersTopTomorrow');
  const cardTom = $('ordersTomorrowCard');

  const mkRow = (x)=>{
    const item = document.createElement('div');
    item.className = 'cmd-order-item';

    const c = document.createElement('div');
    c.className = 'cmd-order-client';
    c.textContent = String(x.cliente || '—');

    const d = document.createElement('div');
    d.className = 'cmd-order-dates';
    const fab = x.fab ? x.fab : '—';
    const ent = x.entrega ? x.entrega : '—';
    d.textContent = `Fab: ${fab} · Ent: ${ent}`;

    item.appendChild(c);
    item.appendChild(d);
    return item;
  };

  if (!ctx.ok){
    setText('ordersPending', 'Pendientes: —');
    setText('ordersTodayHint', ctx.reason || 'No disponible');
    if (listToday) listToday.innerHTML = '';
    if (cardTom) cardTom.hidden = true;
    return { alerts: [], unavailable: Array.isArray(ctx.unavailable) ? ctx.unavailable : [] };
  }

  // Pending line
  if (typeof ctx.pendingCount === 'number'){
    setText('ordersPending', `Pendientes: ${ctx.pendingCount}`);
  } else {
    setText('ordersPending', 'Pendientes: —');
  }

  // Hint
  if (ctx.pendingCount === 0){
    setText('ordersTodayHint', 'No hay pedidos pendientes');
  } else if (ctx.pendingCount === null && ctx.skippedUnknownStatus){
    setText('ordersTodayHint', 'No disponible (hay pedidos sin estado)');
  } else {
    setText('ordersTodayHint', (ctx.topToday && ctx.topToday.length) ? 'Top (más urgentes primero)' : '—');
  }

  // Top today list
  if (listToday){
    listToday.innerHTML = '';
    const top = Array.isArray(ctx.topToday) ? ctx.topToday.slice(0, 5) : [];
    if (!top.length){
      const empty = document.createElement('div');
      empty.className = 'cmd-muted';
      empty.textContent = (ctx.pendingCount === 0) ? '—' : 'Sin datos';
      listToday.appendChild(empty);
    } else {
      top.forEach(x=> listToday.appendChild(mkRow(x)));
    }
  }

  // Tomorrow card
  setText('ordersTomorrowDate', `(${ctx.tomorrow || '—'})`);
  if (cardTom){
    cardTom.hidden = !ctx.tomorrowShow;
  }
  if (ctx.tomorrowShow){
    if (ctx.hasFabField && typeof ctx.tomorrowMake === 'number'){
      setText('tomorrowMake', String(ctx.tomorrowMake));
    } else {
      setText('tomorrowMake', '—');
    }
    setText('tomorrowDeliver', (typeof ctx.tomorrowDeliver === 'number') ? String(ctx.tomorrowDeliver) : '—');

    if (listTom){
      listTom.innerHTML = '';
      const topT = Array.isArray(ctx.topTomorrow) ? ctx.topTomorrow.slice(0, 5) : [];
      if (!topT.length){
        const empty = document.createElement('div');
        empty.className = 'cmd-muted';
        empty.textContent = '—';
        listTom.appendChild(empty);
      } else {
        topT.forEach(x=> listTom.appendChild(mkRow(x)));
      }
    }
  } else {
    if (listTom) listTom.innerHTML = '';
  }

  return { alerts: Array.isArray(ctx.alerts) ? ctx.alerts : [], unavailable: Array.isArray(ctx.unavailable) ? ctx.unavailable : [] };
}

// --- Data compute
async function computeSalesToday(eventId, dayKey){
  const db = state.db;
  if (!db || !hasStore(db, 'sales')) return { ok:false, total:null, count:null, top:null, reason:'No disponible' };

  // Preferir índice by_date (más liviano: solo “hoy”)
  let rows = await idbGetAllByIndex(db, 'sales', 'by_date', IDBKeyRange.only(dayKey));

  if (rows === null){
    // No hay index by_date, fallback (potencialmente pesado)
    const c = await idbCountByIndex(db, 'sales', 'by_event', IDBKeyRange.only(eventId));
    if (typeof c === 'number' && c > SAFE_SCAN_LIMIT) {
      return { ok:false, total:null, count:null, top:null, reason:'No disponible' };
    }
    const allByEvent = await idbGetAllByIndex(db, 'sales', 'by_event', IDBKeyRange.only(eventId));
    if (allByEvent === null) return { ok:false, total:null, count:null, top:null, reason:'No disponible' };
    rows = allByEvent.filter(r => r && String(r.date||'') === dayKey);
  }

  if (!Array.isArray(rows)) return { ok:false, total:null, count:null, top:null, reason:'No disponible' };
  if (rows.length > SAFE_SCAN_LIMIT) return { ok:false, total:null, count:null, top:null, reason:'No disponible' };

  const filtered = rows.filter(r => r && Number(r.eventId) === Number(eventId));
  let total = 0;
  const topMap = new Map();
  for (const s of filtered){
    total += Number(s.total || 0);
    const name = safeStr(s.productName) || 'N/D';
    const q = Number(s.qty || 0);
    // para Top: contar solo ventas (qty > 0)
    if (q > 0){
      topMap.set(name, (topMap.get(name) || 0) + q);
    }
  }
  const top = Array.from(topMap.entries())
    .map(([name, qty])=>({ name, qty }))
    .sort((a,b)=> (b.qty - a.qty))
    .slice(0,3);

  return { ok:true, total, count: filtered.length, top, reason:'' };
}

async function computePettyStatus(ev, dayKey){
  const db = state.db;
  if (!db || !ev){
    return { ok:false, enabled:null, dayState:null, fxMissing:null, fxKnown:false, closedAt:null, reason:'No disponible' };
  }

  const enabled = !!ev.pettyEnabled;
  if (!enabled){
    return { ok:true, enabled:false, dayState:'No aplica', fxMissing:false, fxKnown:false, closedAt:null, reason:'' };
  }

  // POS (esta ZIP): T/C persistente por evento (ev.fxRate). Fallback: legado en Caja Chica (day.fxRate).
  const fxEventRaw = Number(ev.fxRate || 0);
  const fxEvent = (Number.isFinite(fxEventRaw) && fxEventRaw > 0) ? fxEventRaw : null;

  // Si no hay store de Caja Chica, NO inventar el estado del día ni el T/C legado.
  if (!hasStore(db, 'pettyCash')){
    const fxKnown = (fxEvent != null);
    // Si solo tenemos el valor por evento y existe, NO falta. Si no existe, es desconocido.
    const fxMissing = fxKnown ? false : null;
    return { ok:false, enabled:true, dayState:null, fxMissing, fxKnown, closedAt:null, pcDay:null, fxSource: fxKnown ? 'event' : 'unknown', reason:'No disponible' };
  }

  let pc = null;
  try{ pc = await idbGet(db, 'pettyCash', Number(ev.id)); }catch(_){ pc = null; }
  if (!pc || !pc.days || typeof pc.days !== 'object'){
    const fxKnown = (fxEvent != null);
    const fxMissing = fxKnown ? false : null;
    return { ok:false, enabled:true, dayState:null, fxMissing, fxKnown, closedAt:null, pcDay:null, fxSource: fxKnown ? 'event' : 'unknown', reason:'No disponible' };
  }

  const day = pc.days[dayKey];
  if (!day || typeof day !== 'object'){
    const fxKnown = (fxEvent != null);
    const fxMissing = fxKnown ? false : null;
    return { ok:false, enabled:true, dayState:null, fxMissing, fxKnown, closedAt:null, pcDay:null, fxSource: fxKnown ? 'event' : 'unknown', reason:'No disponible' };
  }

  const closedAt = day.closedAt || null;
  const dayState = closedAt ? 'Cerrado' : 'Abierto';

  const fxDayRaw = (day.fxRate != null) ? Number(day.fxRate) : NaN;
  const fxDay = (Number.isFinite(fxDayRaw) && fxDayRaw > 0) ? fxDayRaw : null;

  const fxEffective = (fxEvent != null) ? fxEvent : fxDay;
  const fxKnown = true; // tenemos day (y/o event), así que podemos determinar si falta.
  const fxMissing = !(fxEffective && fxEffective > 0);
  const fxSource = (fxEvent != null) ? 'event' : (fxDay != null ? 'pettyCash' : 'none');

  return { ok:true, enabled:true, dayState, fxMissing, fxKnown, closedAt, pcDay: day, fxSource, reason:'' };
}

async function computeUnclosed7d(ev, pcDayKey){
  if (!ev || !ev.pettyEnabled) return { ok:true, value:'—', reason:'' };
  const db = state.db;
  if (!db || !hasStore(db, 'pettyCash')) return { ok:false, value:'—', reason:'No disponible' };

  const pc = await idbGet(db, 'pettyCash', Number(ev.id));
  if (!pc || !pc.days || typeof pc.days !== 'object') return { ok:false, value:'—', reason:'No disponible' };

  // últimos 7 días incluyendo hoy
  let cnt = 0;
  for (let i = 0; i < 7; i++){
    const d = ymdAddDays(pcDayKey, -i);
    const day = pc.days[d];
    if (!day || typeof day !== 'object') continue;
    // Contar solo si hay actividad (evitar “inventar”)
    if (!hasPettyDayActivity(day)) continue;
    if (!day.closedAt) cnt += 1;
  }
  return { ok:true, value: String(cnt), reason:'' };
}

// --- Alertas (motor + Sincronizar)
const ALERT_LABELS = {
  'petty-open': 'Caja Chica: día abierto',
  'fx-missing': 'Tipo de cambio vacío hoy',
  'checklist-incomplete': 'Checklist hoy incompleto',
  'inventory-critical': 'Inventario crítico',
  'orders-deliver-today': 'Entregas hoy',
  'orders-overdue': 'Entregas vencidas',
  'orders-make-today': 'Hacer sangría hoy',
};

function labelForAlertKey(k){
  try{
    const key = String(k || '');
    if (key.startsWith('orders-make-today:')) return ALERT_LABELS['orders-make-today'];
    return ALERT_LABELS[key] || (key || '—');
  }catch(_){
    return '—';
  }
}


function buildActionableAlerts(ev, dayKey, pc){
  const alerts = [];
  const unavailable = [];

  // 1) Caja Chica activa y hoy NO está cerrado (solo con señal real)
  if (pc && pc.enabled === true){
    if (pc.ok){
      if (pc.dayState === 'Abierto'){
        alerts.push({
          key: 'petty-open',
          icon: '🔓',
          title: 'Caja Chica activa y hoy NO está cerrado',
          sub: `Hoy (${dayKey}): día abierto en Caja Chica`,
          cta: 'Ir a Caja Chica',
          tab: 'caja'
        });
      }
    } else {
      // No se pudo leer el día (no inventar)
      unavailable.push({ key: 'petty-open', label: labelForAlertKey('petty-open'), reason: pc.reason || 'No disponible' });
    }

    // 2) Tipo de cambio vacío hoy (POS actual: ev.fxRate; fallback legado: day.fxRate)
    if (pc.fxKnown === true){
      if (pc.fxMissing === true){
        alerts.push({
          key: 'fx-missing',
          icon: '💱',
          title: 'Tipo de cambio vacío hoy',
          sub: `Hoy (${dayKey}): falta tipo de cambio`,
          cta: 'Ir a Caja Chica',
          tab: 'caja'
        });
      }
    } else {
      // No se puede evaluar con seguridad (store/campo faltante)
      unavailable.push({ key: 'fx-missing', label: labelForAlertKey('fx-missing'), reason: pc.reason || 'No disponible' });
    }
  }

  // 3) Checklist hoy incompleto (solo si existe plantilla)
  if (ev && ev.checklistTemplate && typeof ev.checklistTemplate === 'object'){
    const chk = computeChecklistProgress(ev, dayKey);
    if (chk && chk.ok && typeof chk.checked === 'number' && typeof chk.total === 'number' && chk.total > 0){
      if (chk.checked < chk.total){
        alerts.push({
          key: 'checklist-incomplete',
          icon: '✅',
          title: 'Checklist hoy incompleto',
          sub: `Hoy (${dayKey}): ${chk.checked}/${chk.total}`,
          cta: 'Abrir Checklist',
          tab: 'checklist'
        });
      }
    } else if (chk && !chk.ok){
      unavailable.push({ key: 'checklist-incomplete', label: labelForAlertKey('checklist-incomplete'), reason: chk.reason || 'No disponible' });
    }
  }

  // 4) Inventario crítico — v1: no hay cálculo “fácil/seguro” en esta ZIP
  unavailable.push({ key: 'inventory-critical', label: labelForAlertKey('inventory-critical'), reason: 'No disponible' });

  return { alerts, unavailable };
}

function getRenderedAlertKeys(){
  try{
    const arr = Array.isArray(state.currentAlerts) ? state.currentAlerts : [];
    return arr.map(a=> (a && a.key) ? String(a.key) : '').filter(Boolean);
  }catch(_){
    return [];
  }
}

function diffAlertKeys(beforeKeys, afterKeys){
  const b = new Set(Array.isArray(beforeKeys) ? beforeKeys : []);
  const a = new Set(Array.isArray(afterKeys) ? afterKeys : []);
  const hidden = [];
  const pending = [];
  const added = [];
  for (const k of b){ if (!a.has(k)) hidden.push(k); else pending.push(k); }
  for (const k of a){ if (!b.has(k)) added.push(k); }
  return { hidden, pending, added };
}

function showToast(msg, ms){
  const el = $('cmdToast');
  if (!el) return;
  el.textContent = String(msg || '');
  el.hidden = false;
  try{ clearTimeout(state.__toastT); }catch(_){ }
  state.__toastT = setTimeout(()=>{ el.hidden = true; }, Math.max(700, ms || 1800));
}

function showSyncReport(payload){
  const modal = $('syncReport');
  const body = $('syncReportBody');
  const title = $('syncReportTitle');
  if (!modal || !body || !title) return;

  const escMap = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
  const esc = (s)=> String(s ?? '').replace(/[&<>"']/g, (c)=> escMap[c] || c);

  title.textContent = (payload && payload.title) ? String(payload.title) : 'Resumen';

  const msg = (payload && payload.message)
    ? `<div class="cmd-muted">${esc(payload.message)}</div>`
    : '';

  const section = (h, items, fmt)=>{
    if (!Array.isArray(items) || items.length === 0) return '';
    const li = items.map(x=> `<li>${fmt ? fmt(x) : esc(x)}</li>`).join('');
    return `<h4>${esc(h)}</h4><ul>${li}</ul>`;
  };

  const hidden = (payload && payload.hidden) ? payload.hidden : [];
  const pending = (payload && payload.pending) ? payload.pending : [];
  const added = (payload && payload.added) ? payload.added : [];
  const unavailable = (payload && payload.unavailable) ? payload.unavailable : [];

  const fmtKey = (k)=> esc(labelForAlertKey(k));
  const fmtUn = (u)=>{
    const key = u && (u.key || u.id) ? String(u.key || u.id) : '';
    const label = (u && u.label) ? String(u.label) : labelForAlertKey(key);
    const reason = (u && u.reason) ? String(u.reason) : 'No disponible';
    return `${esc(label)} <span class="cmd-muted">— ${esc(reason)}</span>`;
  };

  body.innerHTML =
    msg +
    section('Ocultadas (resueltas)', hidden, fmtKey) +
    section('Siguen pendientes', pending, fmtKey) +
    section('Nuevas', added, fmtKey) +
    section('No disponibles (—)', unavailable, fmtUn);

  modal.hidden = false;
}

function hideSyncReport(){
  const modal = $('syncReport');
  if (modal) modal.hidden = true;
}

async function syncAlerts(){
  const btn = $('btnSyncAlerts');
  const before = getRenderedAlertKeys();

  if (btn) btn.disabled = true;
  showToast('Sincronizando…', 1200);

  try{
    // Fecha local actual (evita quedarse “ayer” en iPad PWA)
    state.today = todayYMD();
    const dayKey = state.today;

    // Pedidos: fuente real (localStorage/A33Storage)
    const ordersCtx = computeOrdersOperative();

    // Asegurar DB POS abierta (si existe)
    if (!state.db){
      try{
        state.db = await openPosDB({ timeoutMs: 3500 });
      }catch(_){
        state.db = null;
      }
    }

    // Si hay evento enfocado, intentar sincronizarlo (sin bloquear si falla)
    let ev = null;
    if (state.db && state.focusId){
      try{
        await setFocusEvent(Number(state.focusId));
        ev = state.focusEvent;
      }catch(_){
        ev = state.focusEvent;
      }
    }

    // Recalcular UI completa (incluye pedidos)
    await refreshAll();

    const after = getRenderedAlertKeys();
    const diff = diffAlertKeys(before, after);

    // Unavailable (—) para reporte
    const unavailable = [];
    if (ordersCtx && Array.isArray(ordersCtx.unavailable) && ordersCtx.unavailable.length){
      unavailable.push(...ordersCtx.unavailable);
    }

    if (ev && state.db){
      let pc;
      try{
        pc = await computePettyStatus(ev, dayKey);
      }catch(err){
        pc = { ok:false, enabled: (ev && ev.pettyEnabled) ? true : null, reason:'No disponible' };
      }
      const al = buildActionableAlerts(ev, dayKey, pc);
      if (al && Array.isArray(al.unavailable) && al.unavailable.length){
        unavailable.push(...al.unavailable);
      }
    }

    const noChange = diff.hidden.length === 0 && diff.added.length === 0 && (before.join('|') === after.join('|'));
    const evName = (ev && ev.name) ? String(ev.name) : '—';

    if (noChange){
      showSyncReport({ title:'Resumen', message:`Sin cambios. Evento: ${evName}`, unavailable });
    } else {
      showSyncReport({
        title:'Resumen',
        message:`Evento: ${evName}`,
        hidden: diff.hidden,
        pending: diff.pending,
        added: diff.added,
        unavailable
      });
    }
  }catch(err){
    console.warn('Sincronizar alertas: error', err);
    showSyncReport({ title:'Resumen', message:'No disponible. Revisa consola.' });
  }finally{
    if (btn) btn.disabled = false;
  }
}





// --- Navigation
function navigateToPedidos(){
  try{
    window.location.href = ORDERS_ROUTE;
  }catch(_){ }
}

async function navigateToPOS(tab){
  const ev = state.focusEvent;
  if (!ev || !state.db) return;
  try{
    await setMeta(state.db, 'currentEventId', Number(ev.id));
  }catch(_){ }
  const t = safeStr(tab) || 'vender';
  window.location.href = `../pos/index.html?tab=${encodeURIComponent(t)}`;
}

async function navigateToPOSReminders(){
  const ev = state.focusEvent;
  try{
    if (ev && state.db) await setMeta(state.db, 'currentEventId', Number(ev.id));
  }catch(_){ }
  // Deep-link: POS abre Checklist y hace scroll a la card Recordatorios
  window.location.href = `../pos/index.html#checklist-reminders`;
}

// --- Picker
function eventSortKey(ev){
  // Preferir updatedAt, luego createdAt, luego id (todos reales del objeto)
  const u = Number(ev.updatedAt || 0);
  if (u) return u;
  const c = safeStr(ev.createdAt);
  if (c) {
    const ts = Date.parse(c);
    if (isFinite(ts)) return ts;
  }
  return Number(ev.id || 0);
}

function filterEvents(query){
  const q = safeStr(query).toLowerCase();
  if (!q) return state.events.slice(0, 40);
  return state.events
    .filter(ev => {
      const name = safeStr(ev.name).toLowerCase();
      const group = safeStr(ev.groupName).toLowerCase();
      return name.includes(q) || group.includes(q);
    })
    .slice(0, 40);
}

function renderEventList(query){
  const list = $('eventList');
  if (!list) return;
  const items = filterEvents(query);
  list.innerHTML = '';

  if (!items.length){
    const empty = document.createElement('div');
    empty.className = 'cmd-item';
    empty.innerHTML = `<div class="cmd-item-title">Sin resultados</div><div class="cmd-item-sub">Prueba otro término.</div>`;
    list.appendChild(empty);
    return;
  }

  for (const ev of items){
    const row = document.createElement('div');
    const selected = state.focusId != null && Number(state.focusId) === Number(ev.id);
    row.className = 'cmd-item' + (selected ? ' cmd-item-selected' : '');
    const g = safeStr(ev.groupName);
    row.innerHTML = `
      <div class="cmd-item-title">${safeStr(ev.name) || '—'}</div>
      <div class="cmd-item-sub">${g ? ('Grupo: ' + g) : 'Sin grupo'}</div>
    `;
    row.addEventListener('click', ()=> setFocusEvent(Number(ev.id)));
    list.appendChild(row);
  }
}

function showEventList(){
  const list = $('eventList');
  if (!list) return;
  list.hidden = false;
}

function hideEventList(){
  const list = $('eventList');
  if (!list) return;
  list.hidden = true;
}

async function setFocusEvent(eventId){
  const id = Number(eventId);
  if (!id || !state.eventsById.has(id)) return;
  state.focusId = id;
  state.focusEvent = state.eventsById.get(id) || null;

  // Persistencia: meta + localStorage (robusto)
  try{ localStorage.setItem(LS_FOCUS_KEY, String(id)); }catch(_){ }
  try{
    if (state.db && hasStore(state.db, 'meta')){
      await setMeta(state.db, 'currentEventId', id);
    }
  }catch(err){
    console.warn('No se pudo persistir currentEventId en meta', err);
  }

  // UI
  const input = $('eventSearch');
  if (input) input.value = safeStr(state.focusEvent.name) || '';
  renderEventList('');
  hideEventList();
  renderFocusHint();
  renderRadarBasics();

  await refreshAll();
}

// --- Main refresh
async function refreshAll(){
  clearMetricsToDash();
  clearOrdersToDash();

  // Recordatorios (solo lectura): próximos 7 días (hoy + 6) — NO escanear eventos
  await refreshRemindersNext7();

  // Recomendaciones (cache Analítica)
  renderRecos();

  // Inventario en riesgo (localStorage, solo lectura)
  refreshInvRiskBlock();

  // Pedidos (operativo: hoy + mañana)
  const ordersCtx = computeOrdersOperative();
  const ordersOut = renderOrdersOperative(ordersCtx);

  const ev = state.focusEvent;

  // Si no hay evento enfocado o no hay DB POS, NO bloquear entrada: solo deshabilitar navegación POS
  if (!ev || !state.db) {
    setDisabled('btnGoSell', true);
    setDisabled('btnGoCaja', true);
    setDisabled('btnGoResumen', true);
    setDisabled('btnGoChecklist', true);
    setDisabled('btnOpenChecklist', true);
    setDisabled('btnGoPosReminders', true);

    const onlyOrders = (ordersOut && Array.isArray(ordersOut.alerts)) ? ordersOut.alerts : [];
    renderAlerts(onlyOrders.length ? onlyOrders : null);
    return;
  }

  setDisabled('btnGoSell', false);
  setDisabled('btnGoResumen', false);
  setDisabled('btnGoChecklist', false);
  setDisabled('btnOpenChecklist', false);
  setDisabled('btnGoPosReminders', false);

  const dk = state.today;

  // Checklist
  const chk = computeChecklistProgress(ev, dk);
  setText('checklistProgress', chk.text);
  setText('checklistHint', chk.ok ? 'Hoy' : chk.reason);

  // Caja chica
  const pc = await computePettyStatus(ev, dk);
  if (pc.ok && pc.enabled === false){
    setText('pettyState', 'No aplica');
    setText('pettyDayState', '—');
    setText('pettyHint', 'Caja Chica desactivada en este evento.');
    setDisabled('btnGoCaja', true);
  } else if (pc.ok && pc.enabled === true){
    setText('pettyState', 'Activa');
    setText('pettyDayState', pc.dayState || '—');
    setText('pettyHint', pc.dayState ? `Día ${dk}: ${pc.dayState}` : 'No disponible');
    setDisabled('btnGoCaja', false);
  } else if (pc.enabled === true){
    // enabled pero no se pudo leer
    setText('pettyState', 'Activa');
    setText('pettyDayState', '—');
    setText('pettyHint', pc.reason || 'No disponible');
    setDisabled('btnGoCaja', false);
  } else {
    setText('pettyState', '—');
    setText('pettyDayState', '—');
    setText('pettyHint', pc.reason || 'No disponible');
    setDisabled('btnGoCaja', true);
  }

  // Ventas hoy + Top productos
  const sales = await computeSalesToday(Number(ev.id), dk);
  if (sales.ok){
    setText('salesToday', fmtMoneyNIO(sales.total));
    setText('salesTodaySub', (typeof sales.count === 'number') ? (`Registros: ${sales.count}`) : '—');
    setText('salesTodayHint', dk);
    // Top
    if (Array.isArray(sales.top) && sales.top.length){
      renderTop3(sales.top);
      setText('topHint', 'Top 3');
      setText('topProductsHint', dk);
    } else {
      renderTop3([]);
      setText('topHint', '—');
      setText('topProductsHint', 'Sin datos hoy');
    }
  } else {
    setText('salesToday', '—');
    setText('salesTodaySub', '—');
    setText('salesTodayHint', sales.reason || 'No disponible');
    renderTop3([]);
    setText('topHint', '—');
    setText('topProductsHint', 'No disponible');
  }

  // Radar unclosed 7d
  const unc = await computeUnclosed7d(ev, dk);
  setText('radarUnclosed', (unc && unc.ok) ? unc.value : '—');

  // Alertas accionables (solo con señal real)
  const al = buildActionableAlerts(ev, dk, pc);
  const mergedAlerts = ([]
    .concat((ordersOut && Array.isArray(ordersOut.alerts)) ? ordersOut.alerts : [])
    .concat(Array.isArray(al.alerts) ? al.alerts : []));
  renderAlerts(mergedAlerts.length ? mergedAlerts : null);
}

// --- Init
async function init(){
  // Header: hoy
  setText('cmdToday', state.today);

  // Recomendaciones (cache desde Analítica)
  renderRecos();

  const recoRecalcBtn = $('recosRecalcBtn');
  if (recoRecalcBtn){
    recoRecalcBtn.addEventListener('click', ()=>{ recalcRecos(); });
  }
  const openAnaBtn = $('btnOpenAnalytics');
  if (openAnaBtn){
    openAnaBtn.addEventListener('click', ()=>{
      try{ window.location.href = ANALYTICS_ROUTE; }catch(_){ }
    });
  }

  // Inventario en riesgo (no depende de POS/IndexedDB)
  refreshInvRiskBlock();

  // Inventario: toggles (se mantienen abiertos hasta que el usuario los cierre)
  const tL = $('invLiquidsToggle');
  if (tL){
    tL.addEventListener('click', ()=>{
      invViewState.liquidsExpanded = !invViewState.liquidsExpanded;
      refreshInvRiskBlock();
    });
  }
  const tB = $('invBottlesToggle');
  if (tB){
    tB.addEventListener('click', ()=>{
      invViewState.bottlesExpanded = !invViewState.bottlesExpanded;
      refreshInvRiskBlock();
    });
  }

  // Inventario: recalcular (sin recargar página)
  const recalcBtn = $('invRiskRecalcBtn');
  if (recalcBtn){
    recalcBtn.addEventListener('click', ()=>{ refreshInvRiskBlock(); });
  }

  // Detectar si existe Calculadora (si no existe, ocultar "Fabricar")
  // No bloquea la UI: si falla el fetch, asumimos que existe (modo offline).
  probeCalcRoute();

  // Buttons
  const bind = (id, tab)=>{
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', ()=> navigateToPOS(tab));
  };
  bind('btnGoSell', 'vender');
  bind('btnGoCaja', 'caja');
  bind('btnGoResumen', 'resumen');
  bind('btnGoChecklist', 'checklist');
  bind('btnOpenChecklist', 'checklist');

  // Recordatorios: CTA + toggle (solo lectura)
  const goRem = $('btnGoPosReminders');
  if (goRem){
    goRem.addEventListener('click', ()=>{ navigateToPOSReminders(); });
  }
  const tDone = $('remindersToggleDone');
  if (tDone){
    tDone.addEventListener('click', async ()=>{
      remindersSetShowDone(!remindersGetShowDone());
      // Solo re-render de la sección (usa índice liviano, rango 7 días)
      await refreshRemindersNext7();
    });
  }

  // Pedidos: CTA
  const bindPedidos = (id)=>{
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', navigateToPedidos);
  };
  bindPedidos('btnGoPedidosToday');
  bindPedidos('btnGoPedidosTomorrow');

  // Alertas accionables: Sincronizar (pastilla)
  const syncBtn = $('btnSyncAlerts');
  if (syncBtn){
    syncBtn.addEventListener('click', syncAlerts);
  }

  // Modal resumen: cerrar con overlay / botón / Aceptar
  const syncModal = $('syncReport');
  if (syncModal){
    syncModal.addEventListener('click', (e)=>{
      const t = e.target;
      if (!t) return;
      const hit = (t.matches && t.matches('[data-close="1"]')) || (t.closest && t.closest('[data-close="1"]'));
      if (hit) hideSyncReport();
    });
  }
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') hideSyncReport();
  });

  // Picker events
  const input = $('eventSearch');
  const btn = $('eventPickerBtn');
  const list = $('eventList');

  if (input){
    // iOS/Keychain + UX: el input suele estar prellenado con el evento actual.
    // Si filtramos con ese texto al abrir, parece que "solo existe" un evento.
    // Regla operativa: al abrir (focus) mostramos TODOS; al escribir, filtramos.
    input.addEventListener('focus', ()=>{
      renderEventList('');
      showEventList();
      try{ input.select(); }catch(_){ }
    });
    input.addEventListener('input', ()=>{ renderEventList(input.value); showEventList(); });
    input.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape') hideEventList();
    });
  }
  if (btn){
    btn.addEventListener('click', ()=>{
      if (!list) return;
      if (list.hidden){
        // Al abrir por botón, mostrar TODO (sin filtrar por el evento actual prellenado)
        renderEventList('');
        showEventList();
        try{ input && input.focus(); }catch(_){ }
        try{ input && input.select(); }catch(_){ }
      } else {
        hideEventList();
      }
    });
  }
  document.addEventListener('click', (e)=>{
    const picker = $('eventPicker');
    if (!picker || !list) return;
    if (!picker.contains(e.target)) hideEventList();
  });

  clearMetricsToDash();
  renderAlerts(null);

  // Open DB
  let db;
  try{
    db = await openPosDB({ timeoutMs: 3500 });
    state.db = db;
  }catch(err){
    console.warn('Centro de Mando: no se pudo abrir DB del POS', err);
    // Sin DB: dejar todo en “No disponible”, pero nunca bloquear la suite.
    state.db = null;
    state.events = [];
    state.eventsById = new Map();
    renderRadarBasics();
    renderEmpty();
    return;
  }

  // Load events
  try{
    const evs = await idbGetAll(db, 'events');
    state.events = Array.isArray(evs) ? evs.slice() : [];
    state.events.sort((a,b)=> eventSortKey(b) - eventSortKey(a));
    state.eventsById = new Map(state.events.map(e=> [Number(e.id), e]));
  }catch(err){
    console.warn('Centro de Mando: error cargando eventos', err);
    state.events = [];
    state.eventsById = new Map();
  }

  renderRadarBasics();
  renderEmpty();
  if (!state.events.length){
    return;
  }

  // Default focus: POS currentEventId → localStorage → más reciente
  let focusId = null;
  try{
    focusId = await getMeta(db, 'currentEventId');
  }catch(_){ }
  if (!focusId){
    try{
      const raw = localStorage.getItem(LS_FOCUS_KEY);
      const parsed = parseInt(raw || '0', 10);
      if (parsed) focusId = parsed;
    }catch(_){ }
  }
  if (!focusId || !state.eventsById.has(Number(focusId))){
    focusId = Number(state.events[0].id);
  }

  // Pre-render list
  if (input) input.value = safeStr(state.eventsById.get(Number(focusId))?.name || '');
  renderEventList('');
  hideEventList();

  await setFocusEvent(Number(focusId));
}

document.addEventListener('DOMContentLoaded', init);
