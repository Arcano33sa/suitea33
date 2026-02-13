/*
  Suite A33 v4.20.77 — Centro de Mando (OPERATIVO v1)

  Fuentes reales (descubiertas en /pos/app.js dentro de esta ZIP):
  - DB_NAME: 'a33-pos'
  - Stores: meta, events, sales, cashV2, products, inventory, banks
  - Meta key del evento actual: id='currentEventId' (value = number|null)

  Regla clave: NO inventar números.
  Si no se puede leer/calcular fácil y seguro, mostrar “—” + “No disponible”.
*/

// --- Constantes (descubiertas, no adivinadas)
const POS_DB_NAME = 'a33-pos';
const LS_FOCUS_KEY = 'a33_cmd_focusEventId';
const LS_FOCUS_MODE_KEY = 'a33_cmd_focusMode';
const CMD_MODE_EVENT = 'EVENTO';
const CMD_MODE_GLOBAL = 'GLOBAL';
const CMD_GLOBAL_LABEL = 'GLOBAL (Activos)';
const CMD_GLOBAL_VALUE = '__GLOBAL_ACTIVOS__';
const ORDERS_LS_KEY = 'arcano33_pedidos';
const ORDERS_ROUTE = '../pedidos/index.html';
const COMPRAS_PLAN_ROUTE = '../finanzas/index.html#tab=comprasplan';

// Compras (Finanzas → Compras planificación): solo lectura (dock CdM)
const FIN_COMPRAS_CURRENT_KEY = 'a33_finanzas_compras_current_v1';
const SAFE_SCAN_LIMIT = 4000; // seguridad: evitar loops gigantes

// Efectivo v2: cache FX por evento (misma llave que POS)
const CASHV2_FX_LS_KEY = 'A33.EF2.fxByEvent';
// Efectivo v2: bandera ON/OFF por evento (fallback), misma llave que POS
const CASHV2_FLAGS_LS_KEY = 'A33.EF2.eventFlags';

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
  { id:'galon', name:'Galón 3750 ml' },
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
  try{
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
      const data = A33Storage.sharedGet(INV_LS_KEY, null, 'local');
      if (data && typeof data === 'object') return data;
      return null;
    }
  }catch(_){ }

  let raw = null;
  try{
    if (window.A33Storage && typeof A33Storage.getItem === 'function') raw = A33Storage.getItem(INV_LS_KEY);
    else raw = localStorage.getItem(INV_LS_KEY);
  }catch(_){ raw = null; }
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
function computeInvRiskCountsLight(inv){
  try{
    const out = { ok:true, invTotal:0, invRed:0, invYellow:0 };

    // Líquidos
    const srcL = (inv && inv.liquids && typeof inv.liquids === 'object') ? inv.liquids : {};
    const keysL = new Set([...(INV_LIQUIDS_META.map(x=> x.id)), ...Object.keys(srcL || {})]);
    for (const id of keysL){
      const row = (srcL && srcL[id]) ? srcL[id] : {};
      const stock = invNum(row.stock);
      const max = invNum(row.max);

      if (stock <= 0){
        out.invRed++; out.invTotal++;
        continue;
      }
      if (max > 0){
        const ratio = stock / max;
        if (ratio <= 0.20){ out.invRed++; out.invTotal++; }
        else if (ratio <= 0.35){ out.invYellow++; out.invTotal++; }
      }
      // max=0 => unknown: no inventar
    }

    // Botellas
    const srcB = (inv && inv.bottles && typeof inv.bottles === 'object') ? inv.bottles : {};
    const keysB = new Set([...(INV_BOTTLES_META.map(x=> x.id)), ...Object.keys(srcB || {})]);
    for (const id of keysB){
      const row = (srcB && srcB[id]) ? srcB[id] : {};
      const stock = invNum(row.stock);

      if (stock <= 10){ out.invRed++; out.invTotal++; }
      else if (stock <= 20){ out.invYellow++; out.invTotal++; }
    }

    return out;
  }catch(_){
    return { ok:false, invTotal:null, invRed:0, invYellow:0 };
  }
}

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

  // FAIL-SAFE: si inventario está incompleto/corrupto, NO romper el dock ni el CdM.
  try{
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

    // Mantener el dock compacto coherente (solo conteos)
    try{
      const invRed = ((liq && liq.red) ? liq.red.length : 0) + ((bot && bot.red) ? bot.red.length : 0);
      const invYellow = ((liq && liq.yellow) ? liq.yellow.length : 0) + ((bot && bot.yellow) ? bot.yellow.length : 0);
      const invTotal = invRed + invYellow;
      const prev = (dockUI && dockUI.lastCounts) ? dockUI.lastCounts : {};
      renderDockCompactCounts({
        orders: (typeof prev.orders === 'number') ? prev.orders : null,
        reminders: (typeof prev.reminders === 'number') ? prev.reminders : null,
        purchases: (typeof prev.purchases === 'number') ? prev.purchases : null,
        invTotal,
        invRed,
        invYellow,
      });
    }catch(_){ }
  }catch(_){
    try{ renderInvRiskBlock(null, null); }catch(__){ }
    try{ setInvRiskUpdatedAt(new Date()); }catch(__){ }
  }
}


// --- DOM helpers

const $ = (id)=> document.getElementById(id);

// --- Panel global inferior: reservar espacio (iPad/PWA safe)
function bindGlobalDockSpace(){
  try{
    if (bindGlobalDockSpace.__bound) return;
    bindGlobalDockSpace.__bound = true;
    const dock = $('globalDock');
    if (!dock) return;

    const root = document.documentElement;
    const update = ()=>{
      try{
        const r = dock.getBoundingClientRect();
        const h = Math.max(0, Math.round(r.height || 0));
        root.style.setProperty('--cmdDockH', h ? `${h}px` : '0px');
      }catch(_){ }
    };

    const rafUpdate = ()=>{
      try{ window.requestAnimationFrame(update); }catch(_){ update(); }
    };

    // Exponer para toggles (sin depender de ResizeObserver)
    bindGlobalDockSpace.__update = update;
    bindGlobalDockSpace.__rafUpdate = rafUpdate;

    update();
    window.addEventListener('resize', rafUpdate, { passive:true });
    window.addEventListener('orientationchange', rafUpdate, { passive:true });

    try{
      if (window.ResizeObserver){
        const ro = new ResizeObserver(()=>{ update(); });
        ro.observe(dock);
        bindGlobalDockSpace.__ro = ro;
      }
    }catch(_){ }
  }catch(_){ }
}

// --- Dock compacto / expandido (panel inferior)
const dockUI = {
  expanded: false,
  __bound: false,
  lastCounts: { orders:null, reminders:null, purchases:null, invTotal:null, invRed:0, invYellow:0 },
  // Hardening/Perf: evitar renders repetidos y reentrancias en iPad/PWA
  __refreshToken: 0,
  __inflight: false,
  __lastFullAt: 0,
  __lastFullCounts: { orders:null, reminders:null, purchases:null, invTotal:null, invRed:0, invYellow:0 },
  __lastFullFlags: '',
};

function dockCountsEq(a, b){
  // Comparación mínima para gating de render (iPad/PWA). Null/undefined tratados como iguales.
  try{
    const aa = a || {};
    const bb = b || {};
    const norm = (v)=> (v == null ? null : Number(v));
    return (
      norm(aa.orders) === norm(bb.orders) &&
      norm(aa.reminders) === norm(bb.reminders) &&
      norm(aa.purchases) === norm(bb.purchases) &&
      norm(aa.invTotal) === norm(bb.invTotal) &&
      norm(aa.invRed) === norm(bb.invRed) &&
      norm(aa.invYellow) === norm(bb.invYellow)
    );
  }catch(_){
    return false;
  }
}

function isDockExpanded(){
  return !!(dockUI && dockUI.expanded);
}

function applyDockState(){
  const dock = $('globalDock');
  if (!dock) return;
  const expanded = isDockExpanded();

  dock.classList.toggle('cmd-dock-expanded', expanded);
  dock.classList.toggle('cmd-dock-collapsed', !expanded);

  const full = $('globalDockFull');
  if (full) full.hidden = !expanded;

  const chev = $('globalDockChevron');
  if (chev){
    chev.textContent = expanded ? '▲' : '▼';
    chev.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    chev.setAttribute('aria-label', expanded ? 'Colapsar panel inferior' : 'Expandir panel inferior');
  }

  try{
    if (bindGlobalDockSpace.__rafUpdate) bindGlobalDockSpace.__rafUpdate();
  }catch(_){ }
}

function setDockExpanded(v){
  dockUI.expanded = !!v;
  applyDockState();
}

function bindDockChevron(){
  if (dockUI.__bound) return;
  dockUI.__bound = true;
  const btn = $('globalDockChevron');
  if (!btn) return;

  const onToggle = async ()=>{
    try{
      const next = !isDockExpanded();
      setDockExpanded(next);
      if (next){
        // Al expandir: render completo (sin esperar un refresh global)
        try{ await refreshDockOnly(); }catch(_){ }
      }
    }catch(_){ }
  };

  btn.addEventListener('click', onToggle);
}

function setDockChipHidden(id, hidden){
  const el = $(id);
  if (!el) return;
  el.hidden = !!hidden;
}

function setDockText(id, text){
  const el = $(id);
  if (!el) return;
  el.textContent = (text == null || text === '') ? '—' : String(text);
}

function renderDockCompactCounts(counts){
  counts = counts || {};
  const ordersN = (typeof counts.orders === 'number') ? counts.orders : null;
  const remN = (typeof counts.reminders === 'number') ? counts.reminders : null;
  const purchasesN = (typeof counts.purchases === 'number') ? counts.purchases : null;
  const invTotal = (typeof counts.invTotal === 'number') ? counts.invTotal : null;
  const invRed = (typeof counts.invRed === 'number') ? counts.invRed : 0;
  const invYellow = (typeof counts.invYellow === 'number') ? counts.invYellow : 0;

  try{
    dockUI.lastCounts = { orders: ordersN, reminders: remN, purchases: purchasesN, invTotal, invRed, invYellow };
  }catch(_){ }

  setDockText('dockOrdersN', (ordersN == null) ? '—' : String(ordersN));
  setDockText('dockPurchasesN', (purchasesN == null) ? '—' : String(purchasesN));
  setDockText('dockRemindersN', (remN == null) ? '—' : String(remN));
  setDockText('dockInvN', (invTotal == null) ? '—' : String(invTotal));

  const splitEl = $('dockInvSplit');
  if (splitEl){
    const showSplit = (invTotal != null) && (invTotal > 0) && ((invRed > 0) || (invYellow > 0));
    splitEl.hidden = !showSplit;
    if (showSplit) splitEl.textContent = ` (R${invRed}/A${invYellow})`;
    else splitEl.textContent = '';
  }

  const allNumbers = (ordersN != null) && (remN != null) && (purchasesN != null) && (invTotal != null);
  const allZero = allNumbers && (ordersN === 0) && (remN === 0) && (purchasesN === 0) && (invTotal === 0);

  setDockChipHidden('dockAllGood', !allZero);
  setDockChipHidden('dockOrdersChip', allZero);
  setDockChipHidden('dockPurchasesChip', allZero);
  setDockChipHidden('dockRemindersChip', allZero);
  setDockChipHidden('dockInvChip', allZero);
}

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
    // Rerender para mostrar/ocultar acción "Fabricar" (solo si el panel está expandido)
    if (isDockExpanded()) refreshInvRiskBlock();
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

function safeYMD(v){
  // Normaliza YYYY-MM-DD para llaves de stores (robusto para iPad / inputs raros)
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Si viene ISO completo, tomar los primeros 10 chars
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0,10);
  // Intento final: parse de Date
  try{
    const d = new Date(s);
    if (isFinite(d)){
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${day}`;
    }
  }catch(_){ }
  return todayYMD();
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

function fxNorm(v){
  const n = Number(v);
  const r = Math.round(n * 100) / 100;
  if (!Number.isFinite(r) || r <= 0) return null;
  return r;
}

function fmtFX2(v){
  const n = fxNorm(v);
  return (n == null) ? '' : n.toFixed(2);
}

// FX (T/C) — canon por evento (alineado a POS: events.fx)
const FX_EVENT_CANON_PROP = 'fx';
const FX_EVENT_FALLBACK_PROPS = ['exchangeRate','exchange_rate','fxRate','tc','tipoCambio','tipo_cambio'];

function resolveEventFxInfo(ev){
  try{
    if (!ev || typeof ev !== 'object') return { fx:null, source:'none' };
    const eid = Number(ev.id || 0);

    // a) Canon: events.fx
    let fx = fxNorm(ev[FX_EVENT_CANON_PROP]);
    if (fx != null) return { fx, source:'event.fx' };

    // b) Fallback legacy/meta (solo lectura)
    for (const prop of FX_EVENT_FALLBACK_PROPS){
      fx = fxNorm(ev[prop]);
      if (fx != null) return { fx, source: 'event.' + prop };
    }

    // c) Cache por evento (misma llave que POS)
    fx = readCashV2FxCached(eid);
    if (fx != null) return { fx, source:'cache' };

    return { fx:null, source:'none' };
  }catch(_){
    return { fx:null, source:'none' };
  }
}

function readCashV2FxCached(eventId){
  const eid = Number(eventId || 0);
  if (!eid) return null;
  try{
    const raw = localStorage.getItem(CASHV2_FX_LS_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (!m || typeof m !== 'object') return null;
    // Guardado como string "36.50" por evento
    return fxNorm(m[eid] != null ? m[eid] : m[String(eid)]);
  }catch(_){
    return null;
  }
}

function readCashV2FlagsCached(){
  try{
    const raw = localStorage.getItem(CASHV2_FLAGS_LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  }catch(_){ }
  return null;
}

async function resolveCashV2EnabledForEvent(ev){
  // CANON POS (pos/app.js :: cashV2GetFlagForEventObj):
  // 1) ev.cashV2Active (boolean, persistido en store 'events')
  // 2) localStorage A33.EF2.eventFlags[eid]
  // 3) default TRUE (retro-compat): si NO hay evidencia explícita de OFF, NO asumir OFF.
  try{
    if (ev && typeof ev.cashV2Active === 'boolean'){
      return { enabled: !!ev.cashV2Active, source: 'event' };
    }
  }catch(_){ }

  const eid = Number(ev && ev.id);
  if (eid){
    try{
      const m = readCashV2FlagsCached();
      const k = String(eid);
      if (m && Object.prototype.hasOwnProperty.call(m, k)){
        return { enabled: !!m[k], source: 'cache' };
      }
      // Por si guardaron numérico
      if (m && Object.prototype.hasOwnProperty.call(m, eid)){
        return { enabled: !!m[eid], source: 'cache' };
      }
    }catch(_){ }
  }

  return { enabled: true, source: 'default_on' };
}


function safeStr(x){
  const s = (x == null) ? '' : String(x);
  return s.trim();
}


// --- Compras pendientes (Finanzas → Compras planificación) — solo lectura (DATA, sin UI)
function finComprasNormalizePurchased(val){
  // true: true, "true", "1", "si", "sí", "yes" (case-insensitive). Todo lo demás => false.
  if (val === true) return true;
  if (val === 1) return true;
  const s = safeStr(val).toLowerCase();
  if (!s) return false;
  return (s === 'true' || s === '1' || s === 'si' || s === 'sí' || s === 'yes');
}

function finComprasLineHasContent(line){
  if (!line || typeof line !== 'object') return false;
  // Dinámica de Finanzas: cuenta como “con contenido” si tiene cualquiera de estos campos.
  const fields = ['supplierId','supplierName','product','quantity','price'];
  for (const k of fields){
    try{
      const v = line[k];
      if (safeStr(v)) return true;
    }catch(_){ }
  }
  return false;
}

function readFinComprasCurrentSafe(){
  // Lectura robusta: si no existe/corrupto => null (sin lanzar)
  const raw = safeLSGetJSON(FIN_COMPRAS_CURRENT_KEY, null);
  if (!raw || typeof raw !== 'object') return null;

  const sections = (raw.sections && typeof raw.sections === 'object') ? raw.sections : {};
  const proveedores = Array.isArray(sections.proveedores) ? sections.proveedores : [];
  const varias = Array.isArray(sections.varias) ? sections.varias : [];

  // Normalizar sólo lo que necesitamos, sin forzar el resto
  return {
    ...raw,
    sections: { proveedores, varias },
  };
}

function computeFinComprasPending(){
  // Nunca lanzar excepción. Si falla algo => ok:false, pendingCountTotal:null
  try{
    const pcCurrent = readFinComprasCurrentSafe();
    if (!pcCurrent){
      return {
        ok:false,
        pendingCountTotal:null,
        pendingProveedores:[],
        pendingVarias:[],
        updatedAtISO:'',
        updatedAtDisplay:'',
        sourceKey: FIN_COMPRAS_CURRENT_KEY,
      };
    }

    const sec = (pcCurrent.sections && typeof pcCurrent.sections === 'object') ? pcCurrent.sections : {};
    const proveedores = Array.isArray(sec.proveedores) ? sec.proveedores : [];
    const varias = Array.isArray(sec.varias) ? sec.varias : [];

    const pendingProveedores = [];
    const pendingVarias = [];

    const addPending = (srcArr, outArr)=>{
      for (const line of (Array.isArray(srcArr) ? srcArr : [])){
        if (!line || typeof line !== 'object') continue;
        if (!finComprasLineHasContent(line)) continue;
        if (finComprasNormalizePurchased(line.purchased)) continue;

        outArr.push({
          supplierId: line.supplierId ?? '',
          supplierName: safeStr(line.supplierName),
          product: safeStr(line.product),
          quantity: safeStr(line.quantity),
          price: safeStr(line.price),
          total: safeStr(line.total),
        });

        if (outArr.length >= SAFE_SCAN_LIMIT) break; // hard stop
      }
    };

    addPending(proveedores, pendingProveedores);
    addPending(varias, pendingVarias);

    return {
      ok:true,
      pendingCountTotal: pendingProveedores.length + pendingVarias.length,
      pendingProveedores,
      pendingVarias,
      updatedAtISO: safeStr(pcCurrent.updatedAtISO),
      updatedAtDisplay: safeStr(pcCurrent.updatedAtDisplay),
      sourceKey: FIN_COMPRAS_CURRENT_KEY,
    };
  }catch(_){
    return {
      ok:false,
      pendingCountTotal:null,
      pendingProveedores:[],
      pendingVarias:[],
      updatedAtISO:'',
      updatedAtDisplay:'',
      sourceKey: FIN_COMPRAS_CURRENT_KEY,
    };
  }
}

function uiProdNameCMD(name){
  try{
    if (window.A33Presentations && typeof A33Presentations.canonicalizeProductName === 'function'){
      return A33Presentations.canonicalizeProductName(name);
    }
  }catch(_){ }
  return safeStr(name);
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

function safeLSGetString(key){
  try{
    if (window.A33Storage && typeof A33Storage.getItem === 'function') return A33Storage.getItem(key);
    return localStorage.getItem(key);
  }catch(_){
    return null;
  }
}

function hash32FNV1a(str){
  try{
    const s = (str == null) ? '' : String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      // h *= 16777619 (con overflow 32-bit)
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0);
  }catch(_){
    return 0;
  }
}

function computeFinComprasPendingCountAndStamp(){
  // Lite: conteo + sello de cambios (para gating del dock). Nunca lanza.
  try{
    const pcCurrent = readFinComprasCurrentSafe();
    if (!pcCurrent){
      return { ok:false, pendingCountTotal:null, stamp:'x', updatedAtISO:'', updatedAtDisplay:'', sourceKey: FIN_COMPRAS_CURRENT_KEY };
    }

    const sec = (pcCurrent.sections && typeof pcCurrent.sections === 'object') ? pcCurrent.sections : {};
    const proveedores = Array.isArray(sec.proveedores) ? sec.proveedores : [];
    const varias = Array.isArray(sec.varias) ? sec.varias : [];

    let count = 0;
    const bump = (srcArr)=>{
      for (const line of (Array.isArray(srcArr) ? srcArr : [])){
        if (!line || typeof line !== 'object') continue;
        if (!finComprasLineHasContent(line)) continue;
        if (finComprasNormalizePurchased(line.purchased)) continue;
        count++;
        if (count >= SAFE_SCAN_LIMIT) break;
      }
    };
    bump(proveedores);
    if (count < SAFE_SCAN_LIMIT) bump(varias);

    const uISO = safeStr(pcCurrent.updatedAtISO);
    const uDisp = safeStr(pcCurrent.updatedAtDisplay);

    // Sello de cambios robusto:
    // - Preferir updatedAt* si existe, PERO siempre adjuntar hash del raw cuando esté disponible
    //   para cubrir casos donde updatedAt no se refresca aunque el usuario edite montos.
    const raw = safeLSGetString(FIN_COMPRAS_CURRENT_KEY);
    const h = raw ? ('h' + hash32FNV1a(raw).toString(36)) : '';

    let stamp = '';
    if (uISO || uDisp) stamp = 'u' + (uISO || uDisp);
    if (h) stamp = stamp ? (stamp + '|' + h) : h;
    if (!stamp) stamp = 'c' + String(count);

    return {
      ok:true,
      pendingCountTotal: count,
      stamp,
      updatedAtISO: uISO,
      updatedAtDisplay: uDisp,
      sourceKey: FIN_COMPRAS_CURRENT_KEY,
    };
  }catch(_){
    return { ok:false, pendingCountTotal:null, stamp:'x', updatedAtISO:'', updatedAtDisplay:'', sourceKey: FIN_COMPRAS_CURRENT_KEY };
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

  // Reflejar el conteo también en el dock compacto (siempre visible)
  try{
    const prev = (dockUI && dockUI.lastCounts) ? dockUI.lastCounts : {};
    renderDockCompactCounts({
      orders: (typeof prev.orders === 'number') ? prev.orders : null,
      reminders: pendingCount,
      purchases: (typeof prev.purchases === 'number') ? prev.purchases : null,
      invTotal: (typeof prev.invTotal === 'number') ? prev.invTotal : null,
      invRed: (typeof prev.invRed === 'number') ? prev.invRed : 0,
      invYellow: (typeof prev.invYellow === 'number') ? prev.invYellow : 0,
    });
  }catch(_){ }

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

  const sections = getChecklistTemplateSectionsA33(tpl);
  const arr = (x)=> Array.isArray(x) ? x : [];

  // Total desde plantilla por secciones (preferido)
  let total = 0;
  if (sections && sections.hasSections){
    total = arr(sections.pre).length + arr(sections.event).length + arr(sections.close).length;
  } else {
    // Back-compat: plantillas viejas con lista plana
    total = arr(getChecklistTemplateFlatItemsA33(tpl)).length;
  }

  if (!(total > 0)) return { ok:false, text:'—', checked:0, total:0, reason:'Sin plantilla' };

  const dk = String(dayKey || '').trim();
  const day = (dk && ev.days && typeof ev.days === 'object') ? ev.days[dk] : null;
  const st = (day && day.checklistState && typeof day.checklistState === 'object') ? day.checklistState : null;
  const checkedIds = st ? uniq(st.checkedIds) : [];
  const checked = Array.isArray(checkedIds) ? checkedIds.length : 0;

  return { ok:true, text:`${checked}/${total}`, checked, total, reason:'' };
}

function truncateChecklistLine(s, maxLen){
  const v = (s == null) ? '' : String(s);
  // Aplanar whitespace (incluye saltos de línea) para que el truncado/ellipsis sea predecible.
  const t = v.replace(/\s+/g, ' ').trim();
  const m = (typeof maxLen === 'number' && isFinite(maxLen) && maxLen > 10) ? Math.floor(maxLen) : 180;
  if (t.length <= m) return t;
  return (t.slice(0, Math.max(1, m-1)).trimEnd() + '…');
}

function _normStrNoAccentsA33(s){
  try{
    return String((s==null)?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }catch(_){
    return String((s==null)?'':s);
  }
}

function isClearlyPlaceholderChecklistText(s){
  try{
    const t = String((s==null)?'':s).trim();
    if (!t) return true;

    // Normalizar: sin acentos + lower + colapsar whitespace
    let n = _normStrNoAccentsA33(t).toLowerCase().replace(/\s+/g,' ').trim();

    // Micro-robustez: si viene con viñetas/guiones al inicio, los quitamos
    // (p.ej. "• Nuevo ítem" / "- Nuevo item")
    n = n.replace(/^[\u2022\u00B7\*\-\u2013\u2014]+\s*/,'').trim();

    if (n === 'nuevo item' || n.startsWith('nuevo item')) return true;
    if (n === 'item' || n.startsWith('item ')) return true;
  }catch(_){ }
  return false;
}

function _extractTextLikeA33(o){
  if (o == null) return '';
  if (typeof o === 'string') return o;
  if (typeof o !== 'object') return '';
  const keys = ['text','title','name','label','desc','description','value','task','todo'];
  for (const k of keys){
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

function buildDayChecklistTextMap(ev, dayKey){
  const map = new Map();
  try{
    if (!ev || typeof ev !== 'object') return map;
    const dk = String(dayKey || '').trim();
    const day = (ev.days && typeof ev.days === 'object') ? ev.days[dk] : null;
    if (!day || typeof day !== 'object') return map;

    const consider = (id, text)=>{
      const iid = String(id || '').trim();
      const t = String(text || '').trim();
      if (!iid || !t) return;
      if (!map.has(iid)){
        map.set(iid, t);
        return;
      }
      const prev = String(map.get(iid) || '').trim();
      if (isClearlyPlaceholderChecklistText(prev) && !isClearlyPlaceholderChecklistText(t)) map.set(iid, t);
    };

    const scanArray = (arr)=>{
      if (!Array.isArray(arr)) return;
      for (const raw of arr){
        if (!raw) continue;
        if (typeof raw === 'string') continue; // sin id fiable
        if (typeof raw !== 'object') continue;
        const id = raw.id || raw.itemId || raw.key || raw.uid;
        const txt = _extractTextLikeA33(raw);
        consider(id, txt);
      }
    };

    const scanObjMap = (obj)=>{
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
      for (const k in obj){
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        const v = obj[k];
        if (typeof v === 'string') consider(k, v);
        else if (v && typeof v === 'object') consider(k, _extractTextLikeA33(v));
      }
    };

    // Scan profundo (compat): algunos builds guardaron textos por-id en mapas anidados.
    // LIMITES: para evitar escanear ventas/movimientos enormes, solo se usa en sub-objetos de checklist.
    const scanDeep = (root, maxDepth)=>{
      const md = (typeof maxDepth === 'number' && isFinite(maxDepth)) ? Math.max(1, Math.floor(maxDepth)) : 4;
      const seen = new Set();
      const stack = [{ v: root, d: 0 }];
      let steps = 0;
      while (stack.length){
        const cur = stack.pop();
        const v = cur.v;
        const d = cur.d;
        if (v == null) continue;
        if (typeof v !== 'object') continue;
        if (seen.has(v)) continue;
        seen.add(v);
        steps++;
        if (steps > 900) break;

        if (Array.isArray(v)){
          if (d >= md) continue;
          for (let i=v.length-1; i>=0; i--) stack.push({ v: v[i], d: d+1 });
          continue;
        }

        // Objeto con forma de item
        try{
          const id = v.id || v.itemId || v.key || v.uid;
          const txt = _extractTextLikeA33(v);
          if (id && txt) consider(id, txt);
        }catch(_e){}

        // Mapa: { <id>: <string|obj> }
        if (d >= md) continue;
        for (const k in v){
          if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
          const child = v[k];
          if (typeof child === 'string'){
            // Si la key se parece a un id de checklist, úsala.
            if (/^(chk_|rem_|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.test(String(k))) consider(k, child);
          }
          stack.push({ v: child, d: d+1 });
        }
      }
    };

    const st = (day.checklistState && typeof day.checklistState === 'object') ? day.checklistState : null;
    if (st){
      scanArray(st.items); scanObjMap(st.items);
      scanArray(st.list); scanObjMap(st.list);
      scanArray(st.todos); scanObjMap(st.todos);
      scanArray(st.pending); scanObjMap(st.pending);

      // Compat: mapas típicos (textById, texts, overrides)
      scanObjMap(st.textById); scanObjMap(st.texts);
      scanObjMap(st.overrides); scanObjMap(st.draft);

      scanDeep(st, 4);
    }

    const ch = (day.checklist && typeof day.checklist === 'object') ? day.checklist : null;
    if (ch){
      scanArray(ch.items); scanObjMap(ch.items);
      scanArray(ch.list); scanObjMap(ch.list);
      scanObjMap(ch.textById); scanObjMap(ch.texts);
      scanDeep(ch, 4);
    }

    // Compat: estructuras alternativas
    try{ scanObjMap(day.checklistTextById); scanObjMap(day.checklistTexts); scanObjMap(day.checklistTextMap); }catch(_e){}
    try{ scanDeep(day.checklistTextById, 3); scanDeep(day.checklistTexts, 3); scanDeep(day.checklistTextMap, 3); }catch(_e){}

    scanArray(day.checklist);
    try{ scanDeep(day.checklist, 4); }catch(_e){}
  }catch(_){ }
  return map;
}

function resolveTextoPendiente(item, dayTextMap){
  try{
    const it = (item && typeof item === 'object') ? item : {};
    const id = String(it.id || '').trim();
    const cand = [];

    // prioridad: texto del día (si existe)
    try{
      if (dayTextMap && id && typeof dayTextMap.get === 'function'){
        const v = dayTextMap.get(id);
        if (v) cand.push(v);
      }
    }catch(_e){ }

    // luego: campos típicos del template/legacy
    const keys = ['text','title','name','label','desc','description','value'];
    for (const k of keys){
      const v = it[k];
      if (typeof v === 'string' && v.trim()) cand.push(v);
    }

    let fallback = '';
    for (const v of cand){
      const t = String(v || '').trim();
      if (!t) continue;
      if (!isClearlyPlaceholderChecklistText(t)) return t;
      if (!fallback) fallback = t;
    }
    return fallback || '';
  }catch(_){ }
  return '';
}


function getPendingChecklistTexts(ev, dayKey){
  try{
    if (!ev || typeof ev !== 'object') return [];
    const tpl = (ev.checklistTemplate && typeof ev.checklistTemplate === 'object') ? ev.checklistTemplate : null;
    if (!tpl) return [];

    const arr = (x)=> Array.isArray(x) ? x : [];
    const flat = ([]
      .concat(arr(tpl.pre))
      .concat(arr(tpl.evento))
      .concat(arr(tpl.cierre)))
      .filter(x=> x && typeof x === 'object');
    if (!flat.length) return [];

    const dk = String(dayKey || '');
    const day = (ev.days && typeof ev.days === 'object') ? ev.days[dk] : null;
    const st = (day && day.checklistState && typeof day.checklistState === 'object') ? day.checklistState : null;
    const checkedIds = st ? uniq(st.checkedIds) : [];
    const checkedSet = new Set(checkedIds.map(String));

    // Si existe data del día con textos reales, la priorizamos sobre el template (sin reordenar)
    const dayTextMap = buildDayChecklistTextMap(ev, dk);

    const out = [];
    const seen = new Set();
    for (const it of flat){
      const id = String(it.id || '');
      if (!id) continue;
      if (checkedSet.has(id)) continue;

      const raw = resolveTextoPendiente(it, dayTextMap);
      if (!raw) continue;

      // Requisito CdM: nunca mostrar placeholders (“Nuevo ítem”, etc.) en alertas.
      if (isClearlyPlaceholderChecklistText(raw)) continue;

      const t = truncateChecklistLine(raw, 180);
      if (!t) continue;
      if (isClearlyPlaceholderChecklistText(t)) continue;

      const k = _normStrNoAccentsA33(t).toLowerCase().replace(/\s+/g,' ').trim();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }catch(_){ }
  return [];
}

function getFirstPendingChecklistText(ev, dayKey){
  try{
    const pending = getPendingChecklistTexts(ev, dayKey);
    return (Array.isArray(pending) && pending.length) ? pending[0] : null;
  }catch(_){ }
  return null;
}



// --- Checklist por FASE (CdM, solo lectura)
// Objetivo: preparar data agrupada en PRE / EVENTO / CIERRE para UI de alertas.
function inferChecklistPhaseKeyA33(item){
  try{
    const it = (item && typeof item === 'object') ? item : {};
    const raw = (it.fase || it.phase || it.section || it.sectionKey || it.stage || it.bucket);
    const s = String(raw || '').trim();
    if (!s) return 'event';
    const n = _normStrNoAccentsA33(s).toLowerCase().replace(/\s+/g,' ').trim();
    if (!n) return 'event';
    if (n === 'pre' || n === 'pre-evento' || n === 'preevento' || n === 'pre evento' || n === 'pre_evento') return 'pre';
    if (n === 'evento' || n === 'event' || n === 'eventos') return 'event';
    if (n === 'cierre' || n === 'close' || n === 'closing') return 'close';
  }catch(_){ }
  return 'event';
}

function getChecklistTemplateSectionsA33(tpl){
  const arr = (x)=> Array.isArray(x) ? x : [];
  if (!tpl || typeof tpl !== 'object') return { pre:[], event:[], close:[], hasSections:false };

  const pre = ([]
    .concat(arr(tpl.pre))
    .concat(arr(tpl.preEvento))
    .concat(arr(tpl.pre_evento))
    .concat(arr(tpl.preEventoItems))
    .concat(arr(tpl.preItems))
    .concat(arr(tpl.preList))
    .concat(arr(tpl.prelist)))
    .filter(x=> x && typeof x === 'object');

  const event = ([]
    .concat(arr(tpl.evento))
    .concat(arr(tpl.event))
    .concat(arr(tpl.eventoItems))
    .concat(arr(tpl.eventItems))
    .concat(arr(tpl.eventList)))
    .filter(x=> x && typeof x === 'object');

  const close = ([]
    .concat(arr(tpl.cierre))
    .concat(arr(tpl.close))
    .concat(arr(tpl.cierreItems))
    .concat(arr(tpl.closeItems))
    .concat(arr(tpl.post))
    .concat(arr(tpl.postEvento))
    .concat(arr(tpl.post_evento)))
    .filter(x=> x && typeof x === 'object');

  const hasSections = (pre.length + event.length + close.length) > 0;
  return { pre, event, close, hasSections };
}

function getChecklistTemplateFlatItemsA33(tpl){
  const arr = (x)=> Array.isArray(x) ? x : [];
  if (!tpl || typeof tpl !== 'object') return [];
  return ([]
    .concat(arr(tpl.items))
    .concat(arr(tpl.list))
    .concat(arr(tpl.todos))
    .concat(arr(tpl.tasks))
    .concat(arr(tpl.checklist)))
    .filter(x=> x && typeof x === 'object');
}

function hasChecklistEvidenceA33(ev, dayKey){
  try{
    if (!ev || typeof ev !== 'object') return false;
    if (ev.checklistTemplate && typeof ev.checklistTemplate === 'object') return true;
    const dk = String(dayKey || '').trim();
    if (!dk) return false;
    const day = (ev.days && typeof ev.days === 'object') ? ev.days[dk] : null;
    if (!day || typeof day !== 'object') return false;
    if (day.checklistState && typeof day.checklistState === 'object') return true;
    if (Array.isArray(day.checklistItems) && day.checklistItems.length) return true;
    if (Array.isArray(day.items) && day.items.length) return true;
    if (Array.isArray(day.checklist) && day.checklist.length) return true;
    if (day.checklist && typeof day.checklist === 'object') return true;
  }catch(_){ }
  return false;
}




function __a33TsAny(v){
  try{
    if (v == null) return 0;
    if (typeof v === 'number' && isFinite(v)) return v > 0 ? v : 0;
    if (typeof v === 'string'){
      const s = v.trim();
      if (!s) return 0;
      const n = Number(s);
      if (isFinite(n) && n > 0) return n;
      const t = Date.parse(s);
      if (isFinite(t)) return t;
    }
  }catch(_){ }
  return 0;
}

function getChecklistStampA33(ev, dayKey){
  const out = { ts: 0, sig: '' };
  try{
    const dk = String(dayKey || '').trim();
    if (!dk || !ev || typeof ev !== 'object') return out;

    let ts = 0;
    ts = Math.max(ts, __a33TsAny(ev.updatedAt ?? ev.lastUpdatedAt ?? ev.lastModifiedAt ?? ev.modifiedAt));

    const tpl = (ev.checklistTemplate && typeof ev.checklistTemplate === 'object') ? ev.checklistTemplate : null;
    if (tpl){
      ts = Math.max(ts, __a33TsAny(tpl.updatedAt ?? tpl.lastUpdatedAt ?? tpl.lastModifiedAt ?? tpl.modifiedAt));
    }

    const daysObj = (ev.days && typeof ev.days === 'object' && !Array.isArray(ev.days)) ? ev.days : null;
    const day = (daysObj && dk) ? daysObj[dk] : null;
    if (day && typeof day === 'object'){
      ts = Math.max(ts, __a33TsAny(day.updatedAt ?? day.lastUpdatedAt ?? day.lastModifiedAt ?? day.modifiedAt));
      ts = Math.max(ts, __a33TsAny(day.checklistUpdatedAt ?? day.checklistSavedAt ?? day.savedAt));

      const st = (day.checklistState && typeof day.checklistState === 'object') ? day.checklistState : null;
      if (st){
        ts = Math.max(ts, __a33TsAny(st.updatedAt ?? st.lastUpdatedAt ?? st.lastModifiedAt ?? st.modifiedAt ?? st.savedAt));
      }
    }

    const len = (x)=> Array.isArray(x) ? x.length : 0;
    const keysLen = (o)=> (o && typeof o === 'object' && !Array.isArray(o)) ? Object.keys(o).length : 0;

    const parts = [];
    if (tpl){
      const tplN = (
        len(tpl.pre) + len(tpl.preEvento) + len(tpl.pre_evento) + len(tpl.preEventoItems) + len(tpl.preItems) + len(tpl.preList) + len(tpl.prelist) +
        len(tpl.evento) + len(tpl.event) + len(tpl.eventoItems) + len(tpl.eventItems) + len(tpl.eventList) +
        len(tpl.cierre) + len(tpl.close) + len(tpl.cierreItems) + len(tpl.closeItems) + len(tpl.post) + len(tpl.postEvento) + len(tpl.post_evento) +
        len(tpl.items) + len(tpl.list) + len(tpl.todos) + len(tpl.tasks) + len(tpl.checklist)
      );
      parts.push(String(tplN));
    } else {
      parts.push('0');
    }

    if (day && typeof day === 'object'){
      const st = (day.checklistState && typeof day.checklistState === 'object') ? day.checklistState : null;
      const checkedN = (st && Array.isArray(st.checkedIds)) ? st.checkedIds.length : 0;

      const legacyN = len(day.checklistItems) + len(day.items) + len(day.checklist) + (st ? (len(st.items) + len(st.list) + len(st.todos) + len(st.pending)) : 0);

      const txtN = Math.max(
        keysLen(day.checklistTextById), keysLen(day.checklistTexts), keysLen(day.checklistTextMap),
        (st ? Math.max(keysLen(st.textById), keysLen(st.texts), keysLen(st.overrides), keysLen(st.draft)) : 0)
      );

      parts.push(String(checkedN));
      parts.push(String(legacyN));
      parts.push(String(txtN));
    } else {
      parts.push('0'); parts.push('0'); parts.push('0');
    }

    out.ts = ts || 0;
    out.sig = parts.join('.');
  }catch(_){ }
  return out;
}

function buildChecklistPhasesData(ev, dayKey, opts){
  const limit = (opts && typeof opts.limit === 'number' && isFinite(opts.limit)) ? Math.max(1, Math.floor(opts.limit)) : 3;
  const mk = ()=>({ done:0, total:0, pendingTexts:[], pendingCount:0, moreCount:0 });
  const phases = { pre: mk(), event: mk(), close: mk() };

  // Micro-cache (iPad/PWA): clave por (eventId, dayKey, updatedAt si existe).
  let __cacheKey = '';
  try{
    if (typeof state === 'object' && state){
      if (!state.__chkPhaseCache || typeof state.__chkPhaseCache.get !== 'function') state.__chkPhaseCache = new Map();
      const dk0 = String(dayKey || '').trim();
      const id0 = (ev && ev.id != null) ? String(ev.id) : '0';
      const stp = getChecklistStampA33(ev, dk0);
      const ts = Number((stp && stp.ts) || 0) || 0;
      const sig = String((stp && stp.sig) || '');
      __cacheKey = `ph|${id0}|${dk0}|${limit}|${ts}|${sig}`;
      const hit = state.__chkPhaseCache.get(__cacheKey);
      const now = Date.now();
      const ttl = ts ? (10 * 60 * 1000) : 3500; // 10 min si hay updatedAt, si no: corto
      if (hit && hit.v && (now - (hit.t||0)) < ttl){
        return hit.v;
      }
    }
  }catch(_){ __cacheKey = ''; }

  const res = { ok:true, phases, reason:'', limit };

  try{
    if (!ev || typeof ev !== 'object') return { ok:false, phases, reason:'No disponible', limit };
    const dk = String(dayKey || '').trim();
    if (!dk) return { ok:false, phases, reason:'No disponible', limit };

    const day = (ev.days && typeof ev.days === 'object') ? ev.days[dk] : null;
    const st = (day && day.checklistState && typeof day.checklistState === 'object') ? day.checklistState : null;
    const checkedIds = st ? uniq(st.checkedIds) : [];
    const checkedSet = new Set((Array.isArray(checkedIds) ? checkedIds : []).map(String));

    const tpl = (ev.checklistTemplate && typeof ev.checklistTemplate === 'object') ? ev.checklistTemplate : null;

    // Textos reales del día (si existen) tienen prioridad.
    const dayTextMap = buildDayChecklistTextMap(ev, dk);

    const pushPending = (bucket, it, seenSet)=>{
      try{
        const raw = resolveTextoPendiente(it, dayTextMap);
        if (!raw) return;
        if (isClearlyPlaceholderChecklistText(raw)) return;
        const t = truncateChecklistLine(raw, 180);
        if (!t) return;
        if (isClearlyPlaceholderChecklistText(t)) return;
        const k = _normStrNoAccentsA33(t).toLowerCase().replace(/\s+/g,' ').trim();
        if (!k) return;
        if (seenSet && seenSet.has(k)) return;
        if (seenSet) seenSet.add(k);
        bucket.pendingCount += 1;
        if (bucket.pendingTexts.length < limit) bucket.pendingTexts.push(t);
      }catch(_){ }
    };

    const fillFromSection = (sectionArr, bucket)=>{
      const list = (Array.isArray(sectionArr) ? sectionArr : []).filter(x=>x && typeof x === 'object');
      if (list.length > SAFE_SCAN_LIMIT) throw new Error('scan_limit');
      bucket.total = list.length;
      let done = 0;
      const seen = new Set();
      for (const it of list){
        const id = String((it && it.id) || '').trim();
        if (id && checkedSet.has(id)) { done += 1; continue; }
        pushPending(bucket, it, seen);
      }
      bucket.done = done;
      bucket.moreCount = Math.max(0, bucket.pendingCount - limit);
    };

    // 1) Plantilla por secciones (preferido)
    if (tpl){
      const sections = getChecklistTemplateSectionsA33(tpl);
      if (sections && sections.hasSections){
        fillFromSection(sections.pre, phases.pre);
        fillFromSection(sections.event, phases.event);
        fillFromSection(sections.close, phases.close);
        res.ok = true;
      } else {
        // 2) Plantilla vieja: lista plana + fase inferida (fase missing => EVENTO)
        const flat = getChecklistTemplateFlatItemsA33(tpl);
        if (flat && flat.length){
          if (flat.length > SAFE_SCAN_LIMIT) throw new Error('scan_limit');
          const byKey = { pre: phases.pre, event: phases.event, close: phases.close };
          const seenBy = { pre: new Set(), event: new Set(), close: new Set() };
          for (const it of flat){
            const key = inferChecklistPhaseKeyA33(it);
            const b = byKey[key] || phases.event;
            b.total += 1;
            const id = String((it && it.id) || (it && it.itemId) || (it && it.key) || '').trim();
            if (id && checkedSet.has(id)) { b.done += 1; continue; }
            pushPending(b, it, seenBy[key] || seenBy.event);
          }
          phases.pre.moreCount = Math.max(0, phases.pre.pendingCount - limit);
          phases.event.moreCount = Math.max(0, phases.event.pendingCount - limit);
          phases.close.moreCount = Math.max(0, phases.close.pendingCount - limit);
          res.ok = true;
        } else {
          // Sin data clara: neutro (sin crash)
          res.ok = true;
        }
      }
    }

    // 3) Legacy: sin plantilla, intentar leer items del día/estado (fail-safe EVENTO)
    if (!tpl){
      const legacyItems = [];
      const addMany = (x)=>{
        if (!Array.isArray(x)) return;
        const cut = x.length > SAFE_SCAN_LIMIT ? SAFE_SCAN_LIMIT : x.length;
        for (let i=0; i<cut; i++){
          const it = x[i];
          if (it && typeof it === 'object') legacyItems.push(it);
        }
      };

      try{
        if (day && typeof day === 'object'){
          addMany(day.checklistItems);
          addMany(day.items);
          addMany(day.checklist);
        }
      }catch(_){ }

      try{
        if (st && typeof st === 'object'){
          addMany(st.items);
          addMany(st.list);
          addMany(st.todos);
          addMany(st.pending);
        }
      }catch(_){ }

      if (legacyItems.length){
        const byKey = { pre: phases.pre, event: phases.event, close: phases.close };
        const seenBy = { pre: new Set(), event: new Set(), close: new Set() };

        for (const it of legacyItems){
          const key = inferChecklistPhaseKeyA33(it);
          const b = byKey[key] || phases.event;
          b.total += 1;
          const id = String((it && it.id) || (it && it.itemId) || (it && it.key) || '').trim();
          if (id && checkedSet.has(id)) { b.done += 1; continue; }
          pushPending(b, it, seenBy[key] || seenBy.event);
        }

        phases.pre.moreCount = Math.max(0, phases.pre.pendingCount - limit);
        phases.event.moreCount = Math.max(0, phases.event.pendingCount - limit);
        phases.close.moreCount = Math.max(0, phases.close.pendingCount - limit);
      }
    }

  }catch(err){
    res.ok = false;
    res.reason = 'No disponible';
  }

  // Guardar cache (best-effort)
  try{
    if (typeof state === 'object' && state && state.__chkPhaseCache && typeof state.__chkPhaseCache.set === 'function'){
      const dk0 = String(dayKey || '').trim();
      const id0 = (ev && ev.id != null) ? String(ev.id) : '0';
      const stp0 = getChecklistStampA33(ev, dk0);
      const ts0 = Number((stp0 && stp0.ts) || 0) || 0;
      const sig0 = String((stp0 && stp0.sig) || '');
      const ck = __cacheKey || `ph|${id0}|${dk0}|${limit}|${ts0}|${sig0}`;
      state.__chkPhaseCache.set(ck, { t: Date.now(), v: res });
      // podar
      while (state.__chkPhaseCache.size > 90){
        try{ state.__chkPhaseCache.delete(state.__chkPhaseCache.keys().next().value); }catch(_){ break; }
      }
    }
  }catch(_){ }

  return res;
}

// Checklist DETALLADO por fase (GLOBAL cards) — solo lectura
// Devuelve: { ok, phases: { pre:{items:[]}, event:{items:[]}, close:{items:[]} }, reason }
function buildChecklistPhasesDetailedA33(ev, dayKey){
  const mk = ()=>({ items:[] });
  const phases = { pre: mk(), event: mk(), close: mk() };
  const res = { ok:true, phases, reason:'' };

  try{
    if (!ev || typeof ev !== 'object') return { ok:false, phases, reason:'No disponible' };
    const dk = String(dayKey || '').trim();
    if (!dk) return { ok:false, phases, reason:'No disponible' };

    const day = (ev.days && typeof ev.days === 'object') ? ev.days[dk] : null;
    const st = (day && day.checklistState && typeof day.checklistState === 'object') ? day.checklistState : null;
    const checkedIds = st ? uniq(st.checkedIds) : [];
    const checkedSet = new Set((Array.isArray(checkedIds) ? checkedIds : []).map(String));

    const dayTextMap = buildDayChecklistTextMap(ev, dk);

    const seenBy = { pre: new Set(), event: new Set(), close: new Set() };
    const seenIds = new Set();

    const normKey = (s)=>{
      try{ return _normStrNoAccentsA33(String(s||'')).toLowerCase().replace(/\s+/g,' ').trim(); }catch(_){ return ''; }
    };

    const pushItem = (phaseKey, it0)=>{
      try{
        const key = (phaseKey === 'pre' || phaseKey === 'close') ? phaseKey : 'event';
        const bucket = phases[key] || phases.event;
        const it = (it0 && typeof it0 === 'object') ? it0 : {};
        const id = String((it.id != null ? it.id : (it.itemId != null ? it.itemId : (it.key != null ? it.key : (it.idxId != null ? it.idxId : '')))) || '').trim();
        const it2 = (id && !String(it.id || '').trim()) ? ({...it, id}) : it;

        let raw = resolveTextoPendiente(it2, dayTextMap);
        raw = String(raw || '').trim();
        if (!raw) return;
        if (isClearlyPlaceholderChecklistText(raw)) return;

        const text = truncateChecklistLine(raw, 240);
        if (!text) return;
        if (isClearlyPlaceholderChecklistText(text)) return;

        const nk = normKey(text);
        if (!nk) return;
        const seen = seenBy[key] || seenBy.event;
        if (seen.has(nk)) return;
        seen.add(nk);

        const done = (id && checkedSet.has(id)) ? true : !!(it2.done || it2.checked || it2.isDone);

        if (id) seenIds.add(id);
        bucket.items.push({ id: id || '', text, done });
      }catch(_){ }
    };

    const tpl = (ev.checklistTemplate && typeof ev.checklistTemplate === 'object') ? ev.checklistTemplate : null;
    if (tpl){
      const sec = getChecklistTemplateSectionsA33(tpl);
      if (sec && sec.hasSections){
        for (const it of (Array.isArray(sec.pre) ? sec.pre : [])) pushItem('pre', it);
        for (const it of (Array.isArray(sec.event) ? sec.event : [])) pushItem('event', it);
        for (const it of (Array.isArray(sec.close) ? sec.close : [])) pushItem('close', it);
      } else {
        const flat = getChecklistTemplateFlatItemsA33(tpl);
        for (const it of (Array.isArray(flat) ? flat : [])){
          const k = inferChecklistPhaseKeyA33(it);
          pushItem(k, it);
        }
      }
    }

    // Legacy / por día (si no hay plantilla o si hay textos huérfanos)
    if (!tpl){
      const legacyItems = [];
      const addMany = (x)=>{
        if (!Array.isArray(x)) return;
        const cut = x.length > SAFE_SCAN_LIMIT ? SAFE_SCAN_LIMIT : x.length;
        for (let i=0; i<cut; i++){
          const it = x[i];
          if (it && typeof it === 'object') legacyItems.push(it);
        }
      };
      try{ if (day && typeof day === 'object'){ addMany(day.checklistItems); addMany(day.items); addMany(day.checklist); } }catch(_){ }
      try{ if (st && typeof st === 'object'){ addMany(st.items); addMany(st.list); addMany(st.todos); addMany(st.pending); } }catch(_){ }

      for (const it of legacyItems){
        const k = inferChecklistPhaseKeyA33(it);
        pushItem(k, it);
      }
    }

    // Extras: entradas del mapa de textos que no estén representadas por items
    try{
      if (dayTextMap && typeof dayTextMap.entries === 'function'){
        for (const [id0, txt0] of dayTextMap.entries()){
          const id = String(id0 || '').trim();
          if (!id) continue;
          if (seenIds.has(id)) continue;
          const raw = String(txt0 || '').trim();
          if (!raw || isClearlyPlaceholderChecklistText(raw)) continue;
          pushItem('event', { id, text: raw });
        }
      }
    }catch(_){ }

  }catch(_err){
    res.ok = false;
    res.reason = 'No disponible';
  }

  return res;
}

function getFocusedPendingReminderTextsForDay(remRows, ev, dayKey){
  try{
    const rows = Array.isArray(remRows) ? remRows : [];
    const evId = (ev && ev.id != null) ? String(ev.id) : '';
    const dk = String(dayKey || '').trim();
    if (!evId || !dk || !rows.length) return { top:[], pendingCount:0 };

    const filtered = [];
    for (const r of rows){
      if (!r || typeof r !== 'object') continue;
      if (r.done) continue;
      const rdk = safeStr(r.dayKey);
      if (rdk && rdk !== dk) continue;
      const rid = (r.eventId != null) ? String(r.eventId) : '';
      if (!rid || rid !== evId) continue;
      const txt = safeStr(r.text).trim();
      if (!txt) continue;
      if (isClearlyPlaceholderChecklistText(txt)) continue;
      filtered.push(r);
    }

    // Orden consistente con “Recordatorios · Próximos 7 días”
    filtered.sort((a,b)=>{
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

    const top = [];
    const seen = new Set();
    for (const r of filtered){
      const raw = safeStr(r.text);
      const t = truncateChecklistLine(raw, 180);
      if (!t) continue;
      const k = _normStrNoAccentsA33(t).toLowerCase().replace(/\s+/g,' ').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      top.push(t);
      if (top.length >= 3) break;
    }

    return { top, pendingCount: filtered.length };
  }catch(_){
    return { top:[], pendingCount:0 };
  }
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
  focusMode: CMD_MODE_EVENT,
  globalExpanded: new Set(),
  __globalAutoOpened: false,
  today: todayYMD(),
  currentAlerts: [],

  // Compras pendientes (Finanzas → Compras planificación) — data lista (sin UI en Etapa 1)
  comprasPending: null,
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
  if (state.focusMode === CMD_MODE_GLOBAL){
    setText('focusHint', 'GLOBAL · Activos');
    setText('navNote', 'Modo GLOBAL: vista multi-evento (solo eventos activos).');
    return;
  }
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

// --- Focus Mode (EVENTO vs GLOBAL)
function loadFocusMode(){
  try{
    const raw = localStorage.getItem(LS_FOCUS_MODE_KEY);
    const v = (raw == null) ? '' : String(raw).trim().toUpperCase();
    return (v === CMD_MODE_GLOBAL) ? CMD_MODE_GLOBAL : CMD_MODE_EVENT;
  }catch(_){ return CMD_MODE_EVENT; }
}

function persistFocusMode(mode){
  try{
    const v = (mode === CMD_MODE_GLOBAL) ? CMD_MODE_GLOBAL : CMD_MODE_EVENT;
    localStorage.setItem(LS_FOCUS_MODE_KEY, v);
  }catch(_){ }
}

function applyFocusModeToDOM(){
  try{
    if (!document || !document.body) return;
    if (state.focusMode === CMD_MODE_GLOBAL) document.body.classList.add('cmd-mode-global');
    else document.body.classList.remove('cmd-mode-global');
  }catch(_){ }
  try{ setHidden('globalActivesBlock', state.focusMode !== CMD_MODE_GLOBAL); }catch(_){ }
  try{ renderFocusHint(); }catch(_){ }
  try{ if (state.focusMode === CMD_MODE_GLOBAL) renderGlobalActivesView(); }catch(_){ }
}

// --- Eventos activos (fail-safe)
function normLower(v){
  return safeStr(v).trim().toLowerCase();
}

function eventActiveFlag(ev){
  // 1) flags/booleans
  try{
    const b = (ev && (ev.isActive ?? ev.active ?? ev.enCurso ?? ev.inProgress ?? ev.isOpen ?? ev.open));
    if (b === true) return true;
    const c = (ev && (ev.isClosed ?? ev.closed ?? ev.isArchived ?? ev.archived));
    if (c === true) return false;
  }catch(_){ }

  // 2) status strings (si existen)
  try{
    const s = normLower(ev && (ev.status ?? ev.state ?? ev.phase ?? ev.etapa));
    if (!s) return null;
    if (s === 'open' || s === 'abierto' || s === 'activo' || s === 'active' || s === 'en curso' || s === 'encurso' || s === 'running') return true;
    if (s === 'closed' || s === 'cerrado' || s === 'archived' || s === 'archivo' || s === 'finalizado' || s === 'inactivo' || s === 'inactive') return false;
  }catch(_){ }
  return null;
}

function eventActivityTs(ev){
  const u = Number(ev && (ev.updatedAt ?? ev.lastUpdatedAt ?? ev.lastModifiedAt ?? ev.modifiedAt) || 0);
  if (u) return u;
  const c = safeStr(ev && (ev.createdAt ?? ev.created));
  if (c){
    const ts = Date.parse(c);
    if (isFinite(ts)) return ts;
  }
  return 0;
}

function resolveActiveEvents(){
  const all = Array.isArray(state.events) ? state.events : [];
  const now = Date.now();
  const cutoff = now - (14 * 24 * 60 * 60 * 1000);

  const scored = [];
  for (const ev of all){
    if (!ev || ev.id == null) continue;

    const idNum = Number(ev.id);
    if (!isFinite(idNum) || !idNum) continue;

    const flag = eventActiveFlag(ev);
    const ts = eventActivityTs(ev) || eventSortKey(ev) || 0;

    let ok = false;
    if (flag === true) ok = true;
    else if (flag === false) ok = false;
    else ok = !!(ts && ts >= cutoff);

    if (!ok) continue;
    scored.push({ ev, score: ts || 0 });
  }

  scored.sort((a,b)=> Number(b.score||0) - Number(a.score||0));
  const cap = 12; // seguridad iPad (10–15)
  return scored.slice(0, cap).map(x=> x.ev);
}

// --- Vista GLOBAL (activos)
function setFocusGlobal(opts){
  opts = opts || {};
  state.focusMode = CMD_MODE_GLOBAL;
  if (!opts.skipPersist) persistFocusMode(CMD_MODE_GLOBAL);

  // reset estado de colapsables al entrar a GLOBAL
  state.globalExpanded = new Set();
  state.__globalAutoOpened = false;

  // UI: input
  const input = $('eventSearch');
  if (input) input.value = CMD_GLOBAL_LABEL;

  // UI: selector
  try{ renderEventList(''); }catch(_){ }
  try{ hideEventList(); }catch(_){ }

  applyFocusModeToDOM();
}

function toggleGlobalCard(evId){
  const id = Number(evId || 0);
  if (!id) return;
  if (!(state.globalExpanded instanceof Set)) state.globalExpanded = new Set();
  if (state.globalExpanded.has(id)) state.globalExpanded.delete(id);
  else state.globalExpanded.add(id);

  // Performance iPad/PWA: NO rerender completo. Actualizar solo la card.
  try{
    __cmdApplyGlobalCardExpandedState(id);
  }catch(_){
    // fallback ultra-seguro
    try{ renderGlobalActivesView(); }catch(__){ }
  }
}

async function __cmdRefreshGlobalVentasTodayForCard(eventId){
  // Al expandir: refrescar Ventas hoy inmediato (sin depender del intervalo dynT).
  try{
    if (state.focusMode !== CMD_MODE_GLOBAL) return;
    const id = Number(eventId || 0);
    if (!id || !Number.isFinite(id)) return;

    const infl = __cmdEnsureMap('__globalVentasTodayInflight');
    if (infl.get(id)) return;
    infl.set(id, 1);

    const dk = __cmdSafeYMD(state.today) || todayYMD();

    // Forzar revalidación del sello del día cuando el usuario EXPANDE (refresco explícito).
    try{ await __cmdEnsureSalesTodayAgg(dk, { force:true }); }catch(_){ }

    // Resolver evento por id (solo lectura)
    let ev = null;
    try{
      const arr = Array.isArray(state.events) ? state.events : [];
      for (const e of arr){
        if (e && Number(e.id) === id){ ev = e; break; }
      }
    }catch(_){ ev = null; }
    if (!ev) return;

    const v = await __cmdVentasHoyMetric(ev, dk);

    const snaps = __cmdEnsureMap('__globalSnapshots');
    const cur = (snaps && typeof snaps.get === 'function') ? (snaps.get(id) || null) : null;
    const next = (cur && __cmdIsObj(cur)) ? cur : { eventId: id, dayKey: dk, checklistDayKey: dk, alertas:{pendingCount:null}, efectivo:{enabled:null}, ventasHoy:null, hasChecklistItems:false };
    next.dayKey = dk;
    next.ventasHoy = (typeof v === 'number' && isFinite(v)) ? v : null;
    try{ snaps.set(id, next); }catch(_){ }

    try{ __cmdUpdateGlobalCardUI(id, next, ev); }catch(_){ }
  }catch(_){
  }finally{
    try{
      const infl = state.__globalVentasTodayInflight;
      const id = Number(eventId || 0);
      if (infl && typeof infl.delete === 'function') infl.delete(id);
    }catch(__){ }
  }
}

async function __cmdRefreshGlobalTopProductsForCard(eventId){
  // Al expandir (o con tarjeta ya expandida): refrescar Top productos (cache por sello).
  try{
    if (state.focusMode !== CMD_MODE_GLOBAL) return;
    const id = Number(eventId || 0);
    if (!id || !Number.isFinite(id)) return;

    const infl = __cmdEnsureMap('__globalTopProductsInflight');
    if (infl.get(id)) return;
    infl.set(id, 1);

    const dk = __cmdSafeYMD(state.today) || todayYMD();

    // Revalidación del agregador al expandir (refresco explícito).
    try{ await __cmdEnsureSalesTodayAgg(dk, { force:true }); }catch(_){ }

    // Resolver evento por id (solo lectura)
    let ev = null;
    try{
      const arr = Array.isArray(state.events) ? state.events : [];
      for (const e of arr){
        if (e && Number(e.id) === id){ ev = e; break; }
      }
    }catch(_){ ev = null; }
    if (!ev) return;

    const top = await __cmdTopProductsMetric(ev, dk);

    const snaps = __cmdEnsureMap('__globalSnapshots');
    const cur = (snaps && typeof snaps.get === 'function') ? (snaps.get(id) || null) : null;
    const next = (cur && __cmdIsObj(cur)) ? cur : { eventId: id, dayKey: dk, checklistDayKey: dk, checklistDayKeySource:'', alertas:{pendingCount:null}, efectivo:{enabled:null}, ventasHoy:null, topProducts:null, hasChecklistItems:false };
    next.dayKey = dk;
    if (top === null){
      next.topProducts = null;
    } else {
      next.topProducts = Array.isArray(top) ? top.slice(0, 3) : [];
    }
    try{ snaps.set(id, next); }catch(_){ }

    try{ __cmdUpdateGlobalCardUI(id, next, ev); }catch(_){ }
  }catch(_){
  }finally{
    try{
      const infl = state.__globalTopProductsInflight;
      const id = Number(eventId || 0);
      if (infl && typeof infl.delete === 'function') infl.delete(id);
    }catch(__){ }
  }
}


async function __cmdRefreshGlobalAlertasRecosForCard(eventId){
  // Al expandir: calcular Alertas accionables + Recomendaciones (listas útiles) — fail-safe.
  try{
    if (state.focusMode !== CMD_MODE_GLOBAL) return;
    const id = Number(eventId || 0);
    if (!id || !Number.isFinite(id)) return;

    const infl = __cmdEnsureMap('__globalAlertasRecosInflight');
    if (infl.get(id)) return;
    infl.set(id, 1);

    const dk = __cmdSafeYMD(state.today) || todayYMD();

    // Resolver evento por id (solo lectura)
    let ev = null;
    try{
      const arr = Array.isArray(state.events) ? state.events : [];
      for (const e of arr){
        if (e && Number(e.id) === id){ ev = e; break; }
      }
    }catch(_){ ev = null; }
    if (!ev) return;

    const snaps = __cmdEnsureMap('__globalSnapshots');
    const cur = (snaps && typeof snaps.get === 'function') ? (snaps.get(id) || null) : null;
    const next = (cur && __cmdIsObj(cur)) ? cur : { eventId: id, dayKey: dk, checklistDayKey: dk, checklistDayKeySource:'', alertas:{pendingCount:null}, efectivo:{enabled:null}, ventasHoy:null, topProducts:null, hasChecklistItems:false };
    next.dayKey = dk;

    // Estado cashV2 + FX (evento) — con cache interno
    let cv2 = null;
    try{ cv2 = await computeCashV2Status(ev, dk); }catch(_){ cv2 = { ok:false, enabled:null, isOpen:null, dayState:null, opDayKey:null, fx:null, fxMissing:null, fxKnown:false, reason:'No disponible' }; }

    // Alertas accionables (motor existente)
    let al = null;
    try{ al = buildActionableAlerts(ev, dk, cv2, null); }catch(_){ al = { alerts:[], unavailable:[] }; }
    const raw = (al && Array.isArray(al.alerts)) ? al.alerts : [];

    const prio = (k)=>{
      const key = String(k || '');
      if (key === 'fx-missing') return 100;
      if (key === 'orders-overdue') return 95;
      if (key === 'petty-open') return 80;
      if (key === 'checklist-incomplete') return 60;
      if (key === 'orders-deliver-today') return 55;
      if (key === 'inventory-critical') return 40;
      return 10;
    };

    const pendingChk = (next && next.alertas && typeof next.alertas.pendingCount === 'number' && isFinite(next.alertas.pendingCount))
      ? Number(next.alertas.pendingCount)
      : null;

    const list = [];
    for (const a of raw){
      if (!a || typeof a !== 'object') continue;
      const k = (a.key != null) ? String(a.key) : '';
      let title = safeStr(a.title) || labelForAlertKey(k) || '—';
      if (k === 'checklist-incomplete'){
        // Si está al día, NO es alerta.
        if (/al\s*d[ií]a/i.test(title)) continue;
      }
      let sub = safeStr(a.sub) || '';
      if (k === 'checklist-incomplete' && pendingChk != null && pendingChk > 0){
        const extra = `Pendientes: ${pendingChk}`;
        sub = sub ? (sub + ' · ' + extra) : extra;
      }
      list.push({
        key: k,
        icon: (a.icon != null) ? String(a.icon) : '',
        title,
        sub,
        p: prio(k)
      });
    }

    list.sort((x,y)=> (Number(y.p||0) - Number(x.p||0)));
    const top = list.slice(0, 5);

    // Guardar en snapshot (sin afectar KPIs existentes)
    next.__a33AlertasList = top;
    next.__a33AlertasAt = Date.now();

    // Recomendaciones: derivadas + (1) desde Analítica si existe
    const recos = [];
    try{
      if (cv2 && cv2.fxKnown === true && cv2.fxMissing === true){
        recos.push('Definir tipo de cambio (T/C) del evento.');
      }
    }catch(_){ }
    try{
      if (cv2 && cv2.enabled === true && cv2.isOpen === true){
        recos.push('Cerrar efectivo del día operativo para evitar descuadre.');
      }
    }catch(_){ }
    try{
      if (pendingChk != null && pendingChk > 0){
        recos.push(`Completar checklist: ${pendingChk} pendiente${pendingChk === 1 ? '' : 's'}.`);
      }
    }catch(_){ }

    // Recorte + truncado leve (sin periódico)
    const addFromAnalytics = ()=>{
      try{
        const rawR = safeLSGetJSON(ANALYTICS_RECOS_KEY, null);
        const items = (rawR && rawR.ok && Array.isArray(rawR.items)) ? rawR.items : [];
        if (!items.length) return;
        const it = items[0] || null;
        if (!it || typeof it !== 'object') return;
        const t = safeStr(it.title);
        const r = safeStr(it.reason);
        let line = t || '';
        if (r) line = line ? (line + ' — ' + r) : r;
        line = (line && line.length > 160) ? (line.slice(0, 157) + '…') : line;
        if (line) recos.push(line);
      }catch(_){ }
    };

    if (recos.length < 3) addFromAnalytics();

    // Dedup simple
    const seen = new Set();
    const out = [];
    for (const r of recos){
      const t = safeStr(r);
      if (!t) continue;
      const k = _normStrNoAccentsA33(t).toLowerCase().replace(/\s+/g,' ').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= 3) break;
    }

    next.__a33RecosList = out;
    next.__a33RecosAt = Date.now();

    try{ snaps.set(id, next); }catch(_){ }
    try{ __cmdUpdateGlobalCardUI(id, next, ev); }catch(_){ }
  }catch(_){
  }finally{
    try{
      const infl = state.__globalAlertasRecosInflight;
      const id = Number(eventId || 0);
      if (infl && typeof infl.delete === 'function') infl.delete(id);
    }catch(__){ }
  }
}


function __cmdApplyGlobalCardExpandedState(eventId){
  try{
    if (state.focusMode !== CMD_MODE_GLOBAL) return;
    const id = Number(eventId || 0);
    if (!id) return;

    const card = document.querySelector(`.cmd-global-card[data-eid="${id}"]`);
    if (!card) return;

    const expanded = !!(state.globalExpanded instanceof Set && state.globalExpanded.has(id));

    const head = card.querySelector('.cmd-global-head');
    if (head) head.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    // Chevron: se mantiene el mismo glifo; la rotación/estado lo maneja CSS vía aria-expanded.
    const chev = card.querySelector('.cmd-global-chev');
    if (chev) chev.textContent = '▾';

    const body = card.querySelector('.cmd-global-body');
    if (!body) return;

    // Expand/collapse: NO recalcular universo, solo toggle visual.
    if (!expanded){
      try{ body.hidden = true; }catch(_){ }
      return;
    }

    try{ body.hidden = false; }catch(_){ }

    // Refresco inmediato de Ventas hoy (robusto): evita mostrar valor stale si cambió monto sin variar conteo.
    try{ __cmdRefreshGlobalVentasTodayForCard(id); }catch(_){ }

    // Top productos (Etapa 4): solo cuando se expande (cache por sello).
    try{ __cmdRefreshGlobalTopProductsForCard(id); }catch(_){ }

    // Alertas + Recomendaciones (Etapa 5): solo cuando se expande (fail-safe)
    try{ __cmdRefreshGlobalAlertasRecosForCard(id); }catch(_){ }

    // Snapshot actual (fail-safe)
    const snap = (state.__globalSnapshots && typeof state.__globalSnapshots.get === 'function')
      ? (state.__globalSnapshots.get(id) || null)
      : null;

    // Checklist vive dentro del body, separado de las otras secciones (para no borrar UI base).
    const chk = card.querySelector('.cmd-global-checklist');
    if (!chk) return;

    const hasChecklist = !!(snap && snap.hasChecklistItems === true);
    if (!hasChecklist){
      try{ chk.hidden = true; }catch(_){ }
      return;
    }

    try{ chk.hidden = false; }catch(_){ }

    const dk = __cmdSafeYMD(snap && snap.checklistDayKey) || '';
    const cur = (chk.dataset && chk.dataset.dk != null) ? String(chk.dataset.dk || '') : '';

    // Si ya está renderizado con el mismo dayKey, no tocar (sin stutter)
    if (cur == dk && chk.childNodes && chk.childNodes.length) return;

    try{ if (chk.dataset) chk.dataset.dk = dk || ''; }catch(_){ }

    // Resolver evento por id (solo lectura)
    let ev = null;
    try{
      const arr = Array.isArray(state.events) ? state.events : [];
      for (const e of arr){
        if (e && Number(e.id) === id){ ev = e; break; }
      }
    }catch(_){ ev = null; }

    if (!ev){
      chk.innerHTML = '<div class="cmd-muted">No disponible</div>';
      return;
    }

    renderGlobalChecklistForEvent(chk, ev, snap);
  }catch(_){ }
}


// --- GLOBAL (Activos): Checklist por fases (POR EVENTO) — solo lectura
function __cmdTryDayKeyFromEvent(ev){
  try{
    if (!ev || typeof ev !== 'object') return '';
    // 1) Si existe un “día enfocado” en el objeto del evento, úsalo (fail-safe)
    const keys = [
      'focusDayKey','focusedDayKey','currentDayKey','selectedDayKey',
      'dayKey','day','currentDay','focusDay',
      'opDayKey','operativeDayKey','lastDayKey','lastDay'
    ];
    for (const k of keys){
      const v = ev[k];
      const dk = safeYMD(v || '');
      if (dk) return dk;
    }
  }catch(_){ }
  return '';
}

function __cmdHasAnyDayEvidence(ev){
  try{
    const days = (ev && ev.days && typeof ev.days === 'object' && !Array.isArray(ev.days)) ? ev.days : null;
    if (!days) return false;
    // any key that looks like YYYY-MM-DD
    for (const k in days){
      if (!Object.prototype.hasOwnProperty.call(days, k)) continue;
      if (safeYMD(k)) return true;
    }
  }catch(_){ }
  return false;
}
function __cmdMostRecentDayKeyWithData(ev){
  try{
    if (!ev || typeof ev !== 'object') return '';
    const days = (ev.days && typeof ev.days === 'object' && !Array.isArray(ev.days)) ? ev.days : null;
    if (!days) return '';

    const keys = [];
    for (const k in days){
      if (!Object.prototype.hasOwnProperty.call(days, k)) continue;
      const dk = safeYMD(k);
      if (dk) keys.push(dk);
    }
    if (!keys.length) return '';
    keys.sort((a,b)=> b.localeCompare(a));

    // Preferir el día más reciente con evidencia de checklist; si no, el más reciente con cualquier día.
    const hasChkInDay = (day)=>{
      try{
        if (!day || typeof day !== 'object') return false;
        if (day.checklistState && typeof day.checklistState === 'object') return true;
        if (day.checklist && (typeof day.checklist === 'object' || Array.isArray(day.checklist))) return true;
        if (Array.isArray(day.checklistItems) && day.checklistItems.length) return true;
        if (Array.isArray(day.items) && day.items.length) return true;
        if (Array.isArray(day.checklist) && day.checklist.length) return true;
        if (day.checklistTextById && typeof day.checklistTextById === 'object' && Object.keys(day.checklistTextById).length) return true;
        if (day.checklistTexts && typeof day.checklistTexts === 'object' && Object.keys(day.checklistTexts).length) return true;
        if (day.checklistTextMap && typeof day.checklistTextMap === 'object' && Object.keys(day.checklistTextMap).length) return true;
      }catch(_){ }
      return false;
    };

    for (const dk of keys){
      const day = days[dk];
      if (hasChkInDay(day)) return dk;
    }
    return keys[0];
  }catch(_){ }
  return '';
}

function resolveChecklistDayKeyForEventA33(ev){
  // Cache liviano por evento (evita recomputar en cada toggle).
  try{
    if (!state.__globalDayKeyCache || typeof state.__globalDayKeyCache.get !== 'function') state.__globalDayKeyCache = new Map();
    const id = (ev && ev.id != null) ? String(ev.id) : '';
    const hit = id ? state.__globalDayKeyCache.get(id) : null;
    const now = Date.now();
    if (hit && hit.dk && (now - (hit.t||0)) < 6000){
      return { dayKey: String(hit.dk), source: String(hit.source||'cache') };
    }
  }catch(_){ }

  let dk = '';
  let source = '';

  // 1) “día enfocado” si existe
  dk = __cmdTryDayKeyFromEvent(ev);
  if (dk){ source = 'focused'; }

  // 2) día más reciente con data
  if (!dk){
    dk = __cmdMostRecentDayKeyWithData(ev);
    if (dk) source = 'recent';
  }

  // 3) hoy
  if (!dk){
    dk = safeYMD((state && state.today) ? state.today : todayYMD());
    if (dk) source = 'today';
  }

  // 4) neutro
  if (!dk){
    source = 'none';
  }

  // guardar cache (best-effort)
  try{
    if (state.__globalDayKeyCache && typeof state.__globalDayKeyCache.set === 'function'){
      const id = (ev && ev.id != null) ? String(ev.id) : '';
      if (id) state.__globalDayKeyCache.set(id, { t: Date.now(), dk: dk || '', source: source || '' });
      while (state.__globalDayKeyCache.size > 40){
        try{ state.__globalDayKeyCache.delete(state.__globalDayKeyCache.keys().next().value); }catch(_){ break; }
      }
    }
  }catch(_){ }

  return { dayKey: dk || '', source: source || '' };
}

// --- GLOBAL (Activos): Snapshot/KPIs por evento (solo lectura + fail-safe) — Etapa 1/4
function __cmdIsObj(x){ return !!(x && typeof x === 'object' && !Array.isArray(x)); }
function __cmdNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function __cmdRound2(v){
  const n = __cmdNum(v);
  if (n == null) return null;
  const r = Math.round(n * 100) / 100;
  return Number.isFinite(r) ? r : null;
}
function __cmdSafeYMD(v){ return safeYMD(v || ''); }

function __cmdEnsureMap(key){
  try{ if (!state[key] || typeof state[key].get !== 'function') state[key] = new Map(); }catch(_){ state[key] = new Map(); }
  return state[key];
}

// CashV2: helpers (read-only)
const __CASHV2_DENOMS_CMD = {
  NIO: [1000,500,200,100,50,20,10,5,1],
  USD: [100,50,20,10,5,1]
};

function __cmdCashV2Key(eid, dk){
  const id = Number(eid || 0);
  const day = __cmdSafeYMD(dk);
  if (!id || !day) return '';
  return `cash:v2:${id}:${day}`;
}

function __cmdCashV2NormStatus(v){
  const s = String(v || '').trim().toUpperCase();
  if (s === 'OPEN' || s === 'ABIERTO') return 'OPEN';
  if (s === 'CLOSED' || s === 'CERRADO') return 'CLOSED';
  return s || '';
}

function __cmdCashV2SumDenoms(denoms, counts){
  const c = __cmdIsObj(counts) ? counts : {};
  let total = 0;
  for (const d of (Array.isArray(denoms) ? denoms : [])){
    const k1 = String(d);
    let raw = (c[k1] != null) ? c[k1] : c[d];
    if (raw == null || raw === '') raw = 0;
    let n = Number(raw);
    if (!Number.isFinite(n)) n = 0;
    n = Math.trunc(n);
    if (n < 0) n = 0;
    total += Number(d) * n;
  }
  const r = __cmdRound2(total);
  return (r == null) ? 0 : r;
}

function __cmdCashV2ExtractCurrencyTotal(block, ccy){
  try{
    const b = __cmdIsObj(block) ? block : null;
    if (!b) return 0;
    const t = __cmdRound2(b.total);
    if (t != null && t >= 0) return t;
    const den = __cmdIsObj(b.denomCounts) ? b.denomCounts : (__cmdIsObj(b.counts) ? b.counts : null);
    const ds = __CASHV2_DENOMS_CMD[String(ccy||'').trim().toUpperCase()] || [];
    return __cmdCashV2SumDenoms(ds, den);
  }catch(_){
    return 0;
  }
}

function __cmdCashV2SumMovementsByCurrency(movements, currency){
  const ccy = String(currency || '').trim().toUpperCase();
  const arr = Array.isArray(movements) ? movements : [];
  let inc = 0;
  let out = 0;
  let adj = 0;

  for (const m of arr){
    if (!__cmdIsObj(m)) continue;
    if (String(m.currency || '').trim().toUpperCase() !== ccy) continue;
    const k = String(m.kind || '').trim().toUpperCase();
    const allowNeg = (k === 'ADJUST');
    let amt = Number(m.amount);
    if (!Number.isFinite(amt)) amt = 0;
    amt = Math.trunc(amt);
    if (!allowNeg) amt = Math.abs(amt);

    if (k === 'IN' || k === 'ADJUST_IN') inc += Math.abs(amt);
    else if (k === 'OUT' || k === 'ADJUST_OUT') out += Math.abs(amt);
    else if (k === 'ADJUST') adj += amt;
  }

  return { in: __cmdRound2(inc) || 0, out: __cmdRound2(out) || 0, adjust: __cmdRound2(adj) || 0 };
}

function __cmdIsCourtesySale(s){
  try{ return !!(s && (s.courtesy || s.isCourtesy)); }catch(_){ return false; }
}

async function __cmdComputeCashSalesC(eventId, dayKey){
  const db = state.db;
  const eid = Number(eventId || 0);
  const dk = __cmdSafeYMD(dayKey);
  if (!db || !eid || !dk || !hasStore(db,'sales')) return null;

  // Cache micro (si el conteo del día no cambió, reutilizar)
  const cache = __cmdEnsureMap('__globalSalesCashCache');
  const cnt = await idbCountByIndex(db,'sales','by_date', IDBKeyRange.only(dk));
  const cntKey = (cnt == null) ? 'na' : String(cnt);
  const k = `cashSales|${eid}|${dk}|${cntKey}`;
  const hit = cache.get(k);
  if (hit && (Date.now() - (hit.t||0)) < 8000) return hit.v;

  let rows = await idbGetAllByIndex(db,'sales','by_date', IDBKeyRange.only(dk));
  if (rows === null){
    // fallback: por evento (índice) o scan controlado
    rows = await idbGetAllByIndex(db,'sales','by_event', IDBKeyRange.only(eid));
    if (rows === null) rows = await idbGetAll(db,'sales');
  }
  if (!Array.isArray(rows)) rows = [];
  if (rows.length > SAFE_SCAN_LIMIT) return null;

  let sum = 0;
  for (const s of rows){
    if (!__cmdIsObj(s)) continue;
    if (Number(s.eventId) !== eid) continue;
    if (__cmdSafeYMD(s.date || '') !== dk) continue;
    const pay = String(s.payment || '').toLowerCase();
    if (pay !== 'efectivo' && pay !== 'cash') continue;
    if (__cmdIsCourtesySale(s)) continue;
    let t = Number(s.total != null ? s.total : 0);
    if (!Number.isFinite(t)) t = 0;
    sum += t;
  }

  sum = Math.round(sum * 100) / 100;
  if (!Number.isFinite(sum)) return null;

  try{ cache.set(k, { t: Date.now(), v: sum }); while (cache.size > 80) cache.delete(cache.keys().next().value); }catch(_){ }
  return sum;
}

function __cmdCashSigFromRec(rec){
  try{
    if (!__cmdIsObj(rec)) return '';
    const a = Number(rec.updatedAt || 0);
    const b = Number(rec.openTs || 0);
    const c = Number(rec.closeTs || 0);
    const d = Number(rec.ts || 0);
    const st = __cmdCashV2NormStatus(rec.status || '');
    const mv = Array.isArray(rec.movements) ? rec.movements.length : 0;
    const iN = __cmdCashV2ExtractCurrencyTotal(rec.initial && rec.initial.NIO, 'NIO');
    const iU = __cmdCashV2ExtractCurrencyTotal(rec.initial && rec.initial.USD, 'USD');
    return [a,b,c,d,st,mv,iN,iU].join('|');
  }catch(_){
    return '';
  }
}

async function __cmdComputeCashKpisForEvent(ev, dayKey, prevCashMeta){
  // Devuelve objeto { enabled, tc, saldoInicial, ventasEfectivo, totalIngresos, totalEgresos, totalAjustes, saldoFinal, opDayKey }
  // Fail-safe duro: si algo crítico no existe/tipos raros => enabled:true con valores null.
  try{
    const en = await resolveCashV2EnabledForEvent(ev);
    const enabled = !!(en && en.enabled === true);
    if (!enabled) return { enabled:false };

    const eid = Number(ev && ev.id);
    const dkToday = __cmdSafeYMD(dayKey) || __cmdSafeYMD(state.today) || todayYMD();

    const db = state.db;
    if (!db || !hasStore(db,'cashV2')){
      const fxInfo0 = resolveEventFxInfo(ev);
      const tc0 = (fxInfo0 && fxInfo0.fx != null) ? fxInfo0.fx : null;
      return { enabled:true, tc: tc0 || null, saldoInicial:null, ventasEfectivo:null, totalIngresos:null, totalEgresos:null, totalAjustes:null, saldoFinal:null, opDayKey:null };
    }

    // Reusar opDayKey si ya existe y el registro no cambió (micro-cache real por updatedAt/sig).
    if (prevCashMeta && prevCashMeta.opDayKey && prevCashMeta.sig){
      const key = __cmdCashV2Key(eid, prevCashMeta.opDayKey);
      if (key){
        const rec = await idbGet(db,'cashV2', key);
        const sigNow = __cmdCashSigFromRec(rec);
        if (rec && sigNow && sigNow === String(prevCashMeta.sig)){
          return prevCashMeta.kpis;
        }
      }
    }

    // Full resolve (canon existente)
    const st = await computeCashV2Status(ev, dkToday);
    const tc = (st && st.fx != null) ? fxNorm(st.fx) : null;
    const opDayKey = __cmdSafeYMD(st && st.opDayKey) || dkToday;

    // Si no hay día operativo aún
    if (!st || st.ok !== true || !opDayKey){
      return { enabled:true, tc: tc || null, saldoInicial:null, ventasEfectivo:null, totalIngresos:null, totalEgresos:null, totalAjustes:null, saldoFinal:null, opDayKey: opDayKey || null };
    }

    const key = __cmdCashV2Key(eid, opDayKey);
    let rec = key ? await idbGet(db,'cashV2', key) : null;
    if (!rec){
      const byEvDay = await idbGetAllByIndex(db,'cashV2','by_event_day', IDBKeyRange.only([eid, opDayKey]));
      if (Array.isArray(byEvDay) && byEvDay.length) rec = byEvDay[0];
    }

    if (!rec || !__cmdIsObj(rec)){
      return { enabled:true, tc: tc || null, saldoInicial:null, ventasEfectivo:null, totalIngresos:null, totalEgresos:null, totalAjustes:null, saldoFinal:null, opDayKey };
    }

    // Totales iniciales
    const init = __cmdIsObj(rec.initial) ? rec.initial : null;
    const iN = __cmdCashV2ExtractCurrencyTotal(init && init.NIO, 'NIO');
    const iU = __cmdCashV2ExtractCurrencyTotal(init && init.USD, 'USD');

    // Movimientos
    const movs = Array.isArray(rec.movements) ? rec.movements : [];
    const sN = __cmdCashV2SumMovementsByCurrency(movs,'NIO');
    const sU = __cmdCashV2SumMovementsByCurrency(movs,'USD');

    // Ventas en efectivo (C$) — preferir snapshot guardado, fallback a cómputo por ventas
    let cashSalesC = __cmdRound2(rec.cashSalesC);
    if (cashSalesC == null) cashSalesC = await __cmdComputeCashSalesC(eid, opDayKey);
    if (cashSalesC == null) cashSalesC = null;

    // Conversión a NIO (si hay USD involucrado, tc debe existir)
    const usdInPlay = (iU !== 0) || (sU.in !== 0) || (sU.out !== 0) || (sU.adjust !== 0);
    if (usdInPlay && !(tc && tc > 0)){
      return { enabled:true, tc: tc || null, saldoInicial:null, ventasEfectivo: cashSalesC, totalIngresos:null, totalEgresos:null, totalAjustes:null, saldoFinal:null, opDayKey };
    }

    const toC = (nio, usd)=>{
      const a = __cmdRound2(nio) || 0;
      const b = __cmdRound2(usd) || 0;
      if (!usdInPlay) return __cmdRound2(a) || 0;
      return __cmdRound2(a + (b * tc)) || 0;
    };

    const saldoInicial = toC(iN, iU);
    const totalIngresos = toC(sN.in, sU.in);
    const totalEgresos = toC(sN.out, sU.out);
    const totalAjustes = toC(sN.adjust, sU.adjust);

    let saldoFinal = null;
    if (cashSalesC != null){
      saldoFinal = __cmdRound2(saldoInicial + cashSalesC + totalIngresos - totalEgresos + totalAjustes);
    }

    return {
      enabled:true,
      tc: (tc != null) ? __cmdRound2(tc) : null,
      saldoInicial: __cmdRound2(saldoInicial),
      ventasEfectivo: (cashSalesC != null) ? __cmdRound2(cashSalesC) : null,
      totalIngresos: __cmdRound2(totalIngresos),
      totalEgresos: __cmdRound2(totalEgresos),
      totalAjustes: __cmdRound2(totalAjustes),
      saldoFinal: (saldoFinal != null) ? __cmdRound2(saldoFinal) : null,
      opDayKey
    };
  }catch(_){
    const fxInfo = resolveEventFxInfo(ev);
    const tc = (fxInfo && fxInfo.fx != null) ? fxInfo.fx : null;
    return { enabled:true, tc: tc || null, saldoInicial:null, ventasEfectivo:null, totalIngresos:null, totalEgresos:null, totalAjustes:null, saldoFinal:null, opDayKey:null };
  }
}

function __cmdHasChecklistItemsForDay(ev, dayKey){
  // Ítem real = texto no vacío y no placeholder.
  try{
    if (!__cmdIsObj(ev)) return false;
    const dk = __cmdSafeYMD(dayKey);
    if (!dk) return false;

    const dayTextMap = buildDayChecklistTextMap(ev, dk);

    const scanItems = (items)=>{
      const arr = Array.isArray(items) ? items : [];
      for (const it of arr){
        if (!__cmdIsObj(it)) continue;
        const txt = resolveTextoPendiente(it, dayTextMap);
        if (txt && !isClearlyPlaceholderChecklistText(txt)) return true;
      }
      return false;
    };

    // Preferir plantilla por fases
    const tpl = __cmdIsObj(ev.checklistTemplate) ? ev.checklistTemplate : null;
    if (tpl){
      const sec = getChecklistTemplateSectionsA33(ev);
      if (sec && __cmdIsObj(sec)){
        if (scanItems(sec.pre)) return true;
        if (scanItems(sec.event)) return true;
        if (scanItems(sec.close)) return true;
      } else {
        const flat = getChecklistTemplateFlatItemsA33(ev);
        if (scanItems(flat)) return true;
      }
    }

    // Fallback: evidencia por día (legacy)
    const days = (__cmdIsObj(ev.days) ? ev.days : null);
    const day = (days && __cmdIsObj(days[dk])) ? days[dk] : null;
    const st = (day && __cmdIsObj(day.checklistState)) ? day.checklistState : null;

    if (st && __cmdIsObj(st.textById)){
      for (const k in st.textById){
        if (!Object.prototype.hasOwnProperty.call(st.textById,k)) continue;
        const txt = String(st.textById[k] || '').trim();
        if (txt && !isClearlyPlaceholderChecklistText(txt)) return true;
      }
    }

    if (day && Array.isArray(day.checklistItems) && scanItems(day.checklistItems)) return true;
    if (day && Array.isArray(day.items) && scanItems(day.items)) return true;
    if (day && Array.isArray(day.checklist) && scanItems(day.checklist)) return true;

    return false;
  }catch(_){
    return false;
  }
}

function __cmdAlertasPendingCount(ev, dayKey){
  try{
    const dk = __cmdSafeYMD(dayKey);
    if (!dk) return { pendingCount: null };
    const ph = buildChecklistPhasesData(ev, dk, { limit: 1 });
    if (!ph || ph.ok === false) return { pendingCount: null };
    const phases = (ph.phases && __cmdIsObj(ph.phases)) ? ph.phases : {};
    const sum = (b)=>{
      const n = Number(b && b.pendingCount);
      return Number.isFinite(n) ? n : 0;
    };
    return { pendingCount: sum(phases.pre) + sum(phases.event) + sum(phases.close) };
  }catch(_){
    return { pendingCount: null };
  }
}

// --- GLOBAL: Ventas hoy por evento (robusto + refresco coherente) — Etapa 3/5
function __cmdSaleRowHashLite(row){
  // Hash ligero y estable para detectar cambios de monto aunque el conteo no cambie.
  try{
    const id = Number(row && row.id) || 0;
    const total = __cmdRound2(Number(row && row.total) || 0) || 0;
    const qty = Number(row && row.qty) || 0;
    const disc = __cmdRound2(Number(row && row.discount) || 0) || 0;
    return hash32FNV1a(`${id}|${total}|${qty}|${disc}`) >>> 0;
  }catch(_){
    try{ return hash32FNV1a('0|0|0|0') >>> 0; }catch(__){ return 0; }
  }
}

async function __cmdEnsureSalesTodayAgg(dayKey, opts){
  // Agrupa TODAS las ventas del día por evento en una sola pasada (perf GLOBAL).
  try{
    const dk = __cmdSafeYMD(dayKey);
    if (!dk) return { ok:false, dayKey:'', reason:'No disponible' };

    const now = Date.now();
    const force = !!(opts && opts.force === true);
    const hit = (state.__salesTodayAgg && state.__salesTodayAgg.ok && state.__salesTodayAgg.dayKey === dk) ? state.__salesTodayAgg : null;
    // TTL ultra-corto: evita recalcular en cada render pero permite refresco rápido.
    if (!force && hit && (now - Number(hit.t||0)) < 600) return hit;

    const infl = state.__salesTodayAggInflight;
    if (infl && infl.dayKey === dk && infl.p) return infl.p;

    const p = (async()=>{
      const db = state.db;
      if (!db || !hasStore(db,'sales')) return { ok:false, dayKey: dk, reason:'No disponible' };

      let rows = await idbGetAllByIndex(db, 'sales', 'by_date', IDBKeyRange.only(dk));
      if (rows === null){
        // Sin índice: fallback controlado.
        rows = await idbGetAll(db, 'sales');
        if (Array.isArray(rows)) rows = rows.filter(r => r && String(r.date||'') === dk);
      }
      if (!Array.isArray(rows)) rows = [];
      if (rows.length > SAFE_SCAN_LIMIT){
        return { ok:false, dayKey: dk, reason:'No disponible' };
      }

      const totals = new Map();
      const counts = new Map();
      const sumHash = new Map();

      // Lite rows (solo lo necesario) para Top productos (se calcula bajo demanda al expandir).
      const rowsLite = [];

      let dayCount = 0;
      let dayHash = 0;

      for (const r of rows){
        if (!r) continue;
        const eid = Number(r.eventId);
        if (!eid || !Number.isFinite(eid)) continue;

        // Guardar mínimo para Top (sin tocar performance si no se usa).
        try{ rowsLite.push({ eventId: eid, productName: (r && r.productName != null) ? r.productName : (r && r.product != null ? r.product : ''), qty: (r && r.qty != null) ? r.qty : 0 }); }catch(_){ }

        const t = __cmdRound2(Number(r.total) || 0) || 0;
        const prevT = totals.get(eid) || 0;
        totals.set(eid, __cmdRound2(prevT + t) || 0);

        counts.set(eid, (counts.get(eid) || 0) + 1);

        const h = __cmdSaleRowHashLite(r);
        sumHash.set(eid, ((sumHash.get(eid) || 0) + (h >>> 0)) >>> 0);

        dayCount += 1;
        dayHash = (dayHash + (h >>> 0)) >>> 0;
      }

      const stamps = new Map();
      for (const [eid, c] of counts.entries()){
        const h = (sumHash.get(eid) || 0) >>> 0;
        stamps.set(eid, `c${c}|h${h.toString(36)}`);
      }

      const out = {
        ok:true,
        dayKey: dk,
        t: Date.now(),
        dayStamp: `c${dayCount}|h${(dayHash>>>0).toString(36)}`,
        totals,
        stamps,
        rowsLite,
        // Top productos se construye LAZY bajo demanda (al expandir).
        topStamp: '',
        topByEvent: null
      };

      state.__salesTodayAgg = out;
      return out;
    })().finally(()=>{
      try{ if (state.__salesTodayAggInflight && state.__salesTodayAggInflight.dayKey === dk) state.__salesTodayAggInflight = null; }catch(_){ }
    });

    try{ state.__salesTodayAggInflight = { dayKey: dk, p }; }catch(_){ }
    return p;
  }catch(_){
    return { ok:false, dayKey: __cmdSafeYMD(dayKey) || '', reason:'No disponible' };
  }
}

async function __cmdSalesSealForEventDay(eid, dayKey){
  try{
    const dk = __cmdSafeYMD(dayKey);
    const id = Number(eid || 0);
    if (!dk || !id) return '';
    const agg = await __cmdEnsureSalesTodayAgg(dk);
    if (agg && agg.ok){
      return (agg.stamps && typeof agg.stamps.get === 'function') ? (agg.stamps.get(id) || 'c0|h0') : 'c0|h0';
    }
    return '';
  }catch(_){
    return '';
  }
}

async function __cmdVentasHoyMetric(ev, dayKey){
  try{
    const dk = __cmdSafeYMD(dayKey);
    if (!dk) return null;

    const eid = Number(ev && ev.id);
    if (!eid || !Number.isFinite(eid)) return null;

    // Cache por evento+dayKey, invalidación por sello (c/h) para detectar cambios sin variar conteo.
    const cache = __cmdEnsureMap('__globalSalesTodayCache2');
    const ck = `sToday|${eid}|${dk}`;

    // 1) Ruta rápida (GLOBAL): agrupar ventas de HOY 1 vez y leer por evento.
    try{
      const agg = await __cmdEnsureSalesTodayAgg(dk);
      if (agg && agg.ok){
        const stamp = (agg.stamps && typeof agg.stamps.get === 'function') ? (agg.stamps.get(eid) || 'c0|h0') : 'c0|h0';
        const hit = cache.get(ck);
        if (hit && hit.stamp === stamp) return hit.v;

        const v = (agg.totals && typeof agg.totals.get === 'function') ? (agg.totals.get(eid) || 0) : 0;
        const vv = (__cmdRound2(v) == null) ? 0 : (__cmdRound2(v) || 0);
        cache.set(ck, { t: Date.now(), stamp, v: vv });
        while (cache.size > 160){
          try{ cache.delete(cache.keys().next().value); }catch(_){ break; }
        }
        return vv;
      }
    }catch(_){ }

    // 2) Fallback: lógica existente (por evento) — robusto.
    const r = await computeSalesToday(eid, dk);
    if (r && r.ok === true){
      const t = __cmdRound2(r.total);
      const v = (t == null) ? 0 : t;
      // sello fallback: incluye total para detectar cambios aunque no cambie conteo.
      const stamp = `c${Number(r.count||0)||0}|t${Math.round((Number(v)||0)*100)}`;
      cache.set(ck, { t: Date.now(), stamp, v });
      while (cache.size > 160){
        try{ cache.delete(cache.keys().next().value); }catch(_){ break; }
      }
      return v;
    }
    return null;
  }catch(_){
    return null;
  }
}

// --- GLOBAL: Top productos por evento (LAZY + cache por sello) — Etapa 4/5
function __cmdEnsureTopByEventFromAgg(agg){
  try{
    if (!agg || agg.ok !== true) return null;
    const stamp = String(agg.dayStamp || '');
    if (agg.topByEvent && agg.topStamp === stamp) return agg.topByEvent;

    const rows = Array.isArray(agg.rowsLite) ? agg.rowsLite : [];
    const byEv = new Map();

    for (const r of rows){
      if (!r) continue;
      const eid = Number(r.eventId);
      if (!eid || !isFinite(eid)) continue;

      const q0 = Number(r.qty || 0);
      if (!isFinite(q0) || q0 <= 0) continue;

      const name = uiProdNameCMD(r.productName) || 'N/D';
      if (!name) continue;

      let m = byEv.get(eid);
      if (!m){ m = new Map(); byEv.set(eid, m); }
      m.set(name, (m.get(name) || 0) + q0);
    }

    const topByEvent = new Map();
    for (const [eid, m] of byEv.entries()){
      const arr = [];
      for (const [name, qty] of m.entries()){
        const q = Number(qty);
        if (!isFinite(q) || q <= 0) continue;
        arr.push({ name: String(name || 'N/D'), qty: q });
      }
      arr.sort((a,b)=>{
        const dq = (Number(b.qty||0) - Number(a.qty||0));
        if (dq) return dq;
        return String(a.name||'').localeCompare(String(b.name||''));
      });
      topByEvent.set(eid, arr.slice(0, 3));
    }

    try{ agg.topByEvent = topByEvent; }catch(_){ }
    try{ agg.topStamp = stamp; }catch(_){ }
    return topByEvent;
  }catch(_){
    return null;
  }
}

async function __cmdTopProductsMetric(ev, dayKey){
  try{
    const dk = __cmdSafeYMD(dayKey);
    if (!dk) return null;

    const eid = Number(ev && ev.id);
    if (!eid || !Number.isFinite(eid)) return null;

    const cache = __cmdEnsureMap('__globalTopProductsCache2');
    const ck = `top|${eid}|${dk}`;

    // 1) Ruta rápida: usar el agregador del día (mismo patrón que Ventas hoy).
    try{
      const agg = await __cmdEnsureSalesTodayAgg(dk);
      if (agg && agg.ok){
        const stamp = (agg.stamps && typeof agg.stamps.get === 'function') ? (agg.stamps.get(eid) || 'c0|h0') : 'c0|h0';
        const hit = cache.get(ck);
        if (hit && hit.stamp === stamp) return Array.isArray(hit.list) ? hit.list : [];

        const topByEvent = __cmdEnsureTopByEventFromAgg(agg);
        const raw = (topByEvent && typeof topByEvent.get === 'function') ? (topByEvent.get(eid) || []) : [];
        const out = (Array.isArray(raw) ? raw : []).slice(0, 3).map(it=>{
          const name = safeStr(it && it.name) || 'N/D';
          const q0 = Number(it && it.qty);
          const qty = (isFinite(q0) ? q0 : 0);
          return { name, qty };
        });

        cache.set(ck, { t: Date.now(), stamp, list: out });
        while (cache.size > 180){
          try{ cache.delete(cache.keys().next().value); }catch(_){ break; }
        }
        return out;
      }
    }catch(_){ }

    // 2) Fallback: lógica existente (por evento) — robusto.
    const r = await computeSalesToday(eid, dk);
    if (r && r.ok === true){
      const raw = Array.isArray(r.top) ? r.top : [];
      const out = raw.slice(0, 3).map(it=>{
        const name = safeStr(it && it.name) || 'N/D';
        const q0 = Number(it && it.qty);
        const qty = (isFinite(q0) ? q0 : 0);
        return { name, qty };
      });
      const stamp = `c${Number(r.count||0)||0}|t${Math.round((Number(r.total||0)||0)*100)}`;
      cache.set(ck, { t: Date.now(), stamp, list: out });
      while (cache.size > 180){
        try{ cache.delete(cache.keys().next().value); }catch(_){ break; }
      }
      return out;
    }

    return null;
  }catch(_){
    return null;
  }
}

async function __cmdBuildGlobalSnapshot(ev, todayDayKey){
  const eid = Number(ev && ev.id);
  const dkToday = __cmdSafeYMD(todayDayKey) || __cmdSafeYMD(state.today) || todayYMD();

  const chkRes = resolveChecklistDayKeyForEventA33(ev);
  const chkDayKey = __cmdSafeYMD(chkRes && chkRes.dayKey) || dkToday;

  const stamp = getChecklistStampA33(ev, chkDayKey);
  const chkTs = (stamp && stamp.ts != null) ? String(stamp.ts) : '0';
  const chkSig = (stamp && stamp.sig != null) ? String(stamp.sig) : '';

  const cache = __cmdEnsureMap('__globalSnapshotsCache');
  const inflight = __cmdEnsureMap('__globalSnapshotsInflight');
  const cashMetaByEvent = __cmdEnsureMap('__globalCashMetaByEvent');

  // Fail-safe: evitar colisión de cache si el id viene raro
  if (!eid || !isFinite(eid)){
    return {
      eventId: null,
      dayKey: dkToday,
      checklistDayKey: chkDayKey,
      checklistDayKeySource: (chkRes && chkRes.source) ? String(chkRes.source) : '',
      alertas: { pendingCount: null },
      efectivo: { enabled: null },
      ventasHoy: null,
      topProducts: null,
      hasChecklistItems: false
    };
  }

  // Sello de ventas HOY (por evento) para invalidar cache aunque el conteo no cambie.
  let salesSeal = '';
  try{ salesSeal = await __cmdSalesSealForEventDay(eid, dkToday); }catch(_){ salesSeal = ''; }
  const key = `snap|${eid||0}|${dkToday}|${chkDayKey}|${chkTs}|${chkSig}|s${salesSeal||''}`;

  const hit = cache.get(key);
  if (hit && hit.snap){
    // Respetar micro-cache: NO recalcular si no cambió firma/updatedAt.
    // Solo refrescar métricas dinámicas cada pocos segundos (ventas/efectivo) sin tocar checklist/alertas.
    const now = Date.now();
    const lastDyn = Number(hit.dynT || 0) || 0;
    if (!lastDyn || (now - lastDyn) > 5500){
      try{ hit.snap.ventasHoy = await __cmdVentasHoyMetric(ev, dkToday); }catch(_){ }
      // Top productos: SOLO si la tarjeta está expandida (perf + regla del prompt).
      try{
        const ex = !!(state.globalExpanded instanceof Set && state.globalExpanded.has(Number(eid)));
        if (ex){
          hit.snap.topProducts = await __cmdTopProductsMetric(ev, dkToday);
        }
      }catch(_){ }
      try{
        let prevCashMeta = null;
        try{ prevCashMeta = cashMetaByEvent.get(eid) || hit.cashMeta || null; }catch(_){ prevCashMeta = hit.cashMeta || null; }
        hit.snap.efectivo = await __cmdComputeCashKpisForEvent(ev, dkToday, prevCashMeta);

        // actualizar meta cash (firma)
        try{
          const db = state.db;
          const op = hit.snap.efectivo && hit.snap.efectivo.opDayKey ? String(hit.snap.efectivo.opDayKey) : '';
          let sig = '';
          if (db && hasStore(db,'cashV2') && op && eid){
            const rec = await idbGet(db,'cashV2', __cmdCashV2Key(eid, op));
            sig = __cmdCashSigFromRec(rec);
          }
          const meta = { opDayKey: op || null, sig: sig || '', kpis: hit.snap.efectivo };
          try{ cashMetaByEvent.set(eid, meta); }catch(_){ }
          hit.cashMeta = meta;
        }catch(_){ }
      }catch(_){ }
      hit.dynT = now;
    }

    hit.t = now;
    try{ cache.set(key, hit); }catch(_){ }
    return hit.snap;
  }

  const inF = inflight.get(key);
  if (inF) return inF;

  const p = (async()=>{
    // Base neutra
    const snap = {
      eventId: eid || null,
      dayKey: dkToday,
      checklistDayKey: chkDayKey,
      checklistDayKeySource: (chkRes && chkRes.source) ? String(chkRes.source) : '',
      alertas: { pendingCount: null },
      efectivo: { enabled: null },
      ventasHoy: null,
      topProducts: null,
      hasChecklistItems: false
    };

    // Checklist: hasItems + pendingCount (fail-safe)
    try{ snap.hasChecklistItems = __cmdHasChecklistItemsForDay(ev, chkDayKey); }catch(_){ snap.hasChecklistItems = false; }
    try{ snap.alertas = __cmdAlertasPendingCount(ev, chkDayKey); }catch(_){ snap.alertas = { pendingCount: null }; }

    // Ventas hoy (C$) — por día actual (no por chkDayKey)
    try{ snap.ventasHoy = await __cmdVentasHoyMetric(ev, dkToday); }catch(_){ snap.ventasHoy = null; }

    // Efectivo (ON/OFF + métricas si ON)
    let prevCashMeta = null;
    try{ prevCashMeta = cashMetaByEvent.get(eid) || ((hit && hit.cashMeta) ? hit.cashMeta : null); }catch(_){ prevCashMeta = null; }
    const kpis = await __cmdComputeCashKpisForEvent(ev, dkToday, prevCashMeta);
    snap.efectivo = kpis;

    // Guardar meta de cash para micro-cache por firma/updatedAt
    try{
      const db = state.db;
      const op = kpis && kpis.opDayKey ? String(kpis.opDayKey) : '';
      let sig = '';
      if (db && hasStore(db,'cashV2') && op && eid){
        const rec = await idbGet(db,'cashV2', __cmdCashV2Key(eid, op));
        sig = __cmdCashSigFromRec(rec);
      }
      const meta = { opDayKey: op || null, sig: sig || '', kpis };
      try{ cashMetaByEvent.set(eid, meta); }catch(_){ }
      try{
        cache.set(key, { t: Date.now(), dynT: Date.now(), snap, cashMeta: meta });
        while (cache.size > 120){
          try{ cache.delete(cache.keys().next().value); }catch(_){ break; }
        }
      }catch(_){ }
    }catch(_){
      try{
        cache.set(key, { t: Date.now(), dynT: Date.now(), snap, cashMeta: null });
        while (cache.size > 120){
          try{ cache.delete(cache.keys().next().value); }catch(_){ break; }
        }
      }catch(_){ }
    }

    return snap;
  })().finally(()=>{ try{ inflight.delete(key); }catch(_){ } });

  inflight.set(key, p);
  return p;
}

function __cmdPrimeGlobalSnapshots(items){
  // No bloquear render. Dedup por firma (micro-cache) y fail-safe duro.
  try{
    if (!Array.isArray(items) || !items.length) return;
    const dk = __cmdSafeYMD(state.today) || todayYMD();

    // Prefetch: agrupar ventas de hoy 1 vez (mejora perf con 10+ eventos).
    try{ __cmdEnsureSalesTodayAgg(dk); }catch(_){ }

    const out = __cmdEnsureMap('__globalSnapshots');

    // Concurrencia baja para iPad.
    const queue = items.slice(0, 15);
    const limit = 3;
    let idx = 0;

    const worker = async()=>{
      while (idx < queue.length){
        const cur = queue[idx++];
        try{
          if (!cur || cur.id == null) continue;
          const snap = await __cmdBuildGlobalSnapshot(cur, dk);
          try{ out.set(Number(cur.id), snap); }catch(_){ }
          try{ __cmdUpdateGlobalCardUI(Number(cur.id), snap, cur); }catch(_){ }
        }catch(_){
          const fallback = { eventId: Number(cur && cur.id) || null, dayKey: dk, checklistDayKey: dk, alertas:{pendingCount:null}, efectivo:{enabled:null}, ventasHoy:null, hasChecklistItems:false };
          try{ out.set(Number(cur && cur.id), fallback); }catch(_){ }
          try{ __cmdUpdateGlobalCardUI(Number(cur && cur.id), fallback, cur); }catch(_){ }
        }
      }
    };

    // Disparar en microtask (no depender del orden de carga)
    Promise.resolve().then(()=>{
      for (let i=0; i<limit; i++) worker();
    });
  }catch(_){ }
}

function renderChecklistPhasesGridInto(containerEl, ph){
  if (!containerEl) return;

  const phases = (ph && ph.phases && typeof ph.phases === 'object') ? ph.phases : {};
  const ok = (ph && ph.ok === false) ? false : true;
  const lim = (ph && typeof ph.limit === 'number' && isFinite(ph.limit) && ph.limit > 0) ? Math.floor(ph.limit) : 3;

  const makeCol = (label, bucket)=>{
    const col = document.createElement('div');
    col.className = 'cmd-chk-col';

    const hdr = document.createElement('div');
    hdr.className = 'cmd-chk-hdr';

    const name = document.createElement('span');
    name.className = 'cmd-chk-name';
    name.textContent = label;

    const prog = document.createElement('span');
    prog.className = 'cmd-chk-prog';
    if (ok === false){
      prog.textContent = '—';
    } else {
      const done = (bucket && typeof bucket.done === 'number') ? bucket.done : Number(bucket && bucket.done) || 0;
      const total = (bucket && typeof bucket.total === 'number') ? bucket.total : Number(bucket && bucket.total) || 0;
      prog.textContent = `${done}/${total}`;
    }

    hdr.appendChild(name);
    hdr.appendChild(prog);

    const body = document.createElement('div');
    body.className = 'cmd-chk-body';

    if (ok === false){
      body.textContent = (ph && ph.reason) ? String(ph.reason) : 'No disponible';
    } else {
      const texts = (bucket && Array.isArray(bucket.pendingTexts)) ? bucket.pendingTexts : [];
      const pendingCount = (bucket && typeof bucket.pendingCount === 'number' && isFinite(bucket.pendingCount))
        ? bucket.pendingCount
        : (Array.isArray(texts) ? texts.length : 0);

      if (texts && texts.length){
        const top = texts.slice(0, lim);
        for (const t of top){
          const line = document.createElement('span');
          line.className = 'cmd-chk-item';
          line.textContent = `• ${String(t || '')}`;
          body.appendChild(line);
        }

        const more = (bucket && typeof bucket.moreCount === 'number' && isFinite(bucket.moreCount))
          ? bucket.moreCount
          : Math.max(0, pendingCount - lim);

        if (more > 0){
          const moreLine = document.createElement('span');
          moreLine.className = 'cmd-chk-item cmd-chk-more';
          moreLine.textContent = `+${more} más`;
          body.appendChild(moreLine);
        }
      } else {
        const okLine = document.createElement('span');
        okLine.className = 'cmd-chk-item cmd-chk-ok';
        okLine.textContent = 'Al día ✅';
        body.appendChild(okLine);
      }
    }

    col.appendChild(hdr);
    col.appendChild(body);
    return col;
  };

  const grid = document.createElement('div');
  grid.className = 'cmd-chk-grid cmd-chk-grid-global';
  grid.appendChild(makeCol('PRE-EVENTO', phases.pre || null));
  grid.appendChild(makeCol('EVENTO', phases.event || null));
  grid.appendChild(makeCol('CIERRE', phases.close || null));

  containerEl.appendChild(grid);
}

function renderChecklistPhasesDetailedInto(containerEl, ph){
  if (!containerEl) return;

  const phases = (ph && ph.phases && typeof ph.phases === 'object') ? ph.phases : {};
  const ok = (ph && ph.ok === false) ? false : true;

  const makeCol = (label, bucket)=>{
    const col = document.createElement('div');
    col.className = 'cmd-chk-col';

    const hdr = document.createElement('div');
    hdr.className = 'cmd-chk-hdr';

    const name = document.createElement('span');
    name.className = 'cmd-chk-name';
    name.textContent = label;

    const prog = document.createElement('span');
    prog.className = 'cmd-chk-prog';
    // Detallado: sin contadores ruidosos. Mantener el layout estable.
    prog.textContent = '';

    hdr.appendChild(name);
    hdr.appendChild(prog);

    const body = document.createElement('div');
    body.className = 'cmd-chk-body cmd-chk-body-detailed';

    if (ok === false){
      body.textContent = (ph && ph.reason) ? String(ph.reason) : 'No disponible';
    } else {
      const items = (bucket && Array.isArray(bucket.items)) ? bucket.items : [];
      if (!items.length){
        const em = document.createElement('div');
        em.className = 'cmd-muted';
        em.textContent = '—';
        body.appendChild(em);
      } else {
        const frag = document.createDocumentFragment();
        for (const it of items){
          const row = document.createElement('div');
          row.className = 'cmd-chk-row' + ((it && it.done) ? ' is-done' : '');

          const mark = document.createElement('span');
          mark.className = 'cmd-chk-mark';
          mark.textContent = (it && it.done) ? '✓' : '•';

          const tx = document.createElement('span');
          tx.className = 'cmd-chk-text';
          tx.textContent = (it && it.text != null) ? String(it.text) : '';

          row.appendChild(mark);
          row.appendChild(tx);
          frag.appendChild(row);
        }
        body.appendChild(frag);
      }
    }

    col.appendChild(hdr);
    col.appendChild(body);
    return col;
  };

  const grid = document.createElement('div');
  grid.className = 'cmd-chk-grid cmd-chk-grid-global cmd-chk-grid-detailed';
  grid.appendChild(makeCol('PRE-EVENTO', phases.pre || null));
  grid.appendChild(makeCol('EVENTO', phases.event || null));
  grid.appendChild(makeCol('CIERRE', phases.close || null));

  containerEl.appendChild(grid);
}

function renderGlobalChecklistForEvent(bodyEl, ev, snap){
  if (!bodyEl) return;
  bodyEl.innerHTML = '';

  // Condición CRÍTICA: si hasChecklistItems=false => NO mostrar NADA del checklist.
  const has = !!(snap && snap.hasChecklistItems === true);
  if (!has) return;

  const dk = __cmdSafeYMD(snap && snap.checklistDayKey)
    || __cmdSafeYMD((resolveChecklistDayKeyForEventA33(ev) || {}).dayKey)
    || __cmdSafeYMD(state.today)
    || todayYMD();

  let ph = null;
  try{
    ph = buildChecklistPhasesDetailedA33(ev, dk);
  }catch(_){
    ph = null;
  }

  if (!ph || ph.ok === false){
    const n = document.createElement('div');
    n.className = 'cmd-muted';
    n.textContent = (ph && ph.reason) ? String(ph.reason) : 'No disponible';
    bodyEl.appendChild(n);
    return;
  }

  renderChecklistPhasesDetailedInto(bodyEl, ph);
}

function __cmdGlobalFmtDash(v){
  return (v == null) ? '—' : String(v);
}

function __cmdGlobalFmtMaybeFx(v){
  try{
    if (typeof v === 'number' && isFinite(v)){
      const s = String(fmtFX2(v) || '').trim();
      return s || '—';
    }
  }catch(_){ }
  return '—';
}

function __cmdGlobalFmtMaybeMoney(v){
  try{
    if (typeof v === 'number' && isFinite(v)) return fmtMoneyNIO(v);
  }catch(_){ }
  return '—';
}

function __cmdGlobalFmtSignedMoney(v, mode){
  if (!(typeof v === 'number' && isFinite(v))) return '—';
  const abs = Math.abs(v);
  const m = __cmdGlobalFmtMaybeMoney(abs);
  if (m === '—') return '—';
  if (mode === 'out') return `-${m}`;
  if (mode === 'in') return `+${m}`;
  // adj
  return (v < 0) ? `-${m}` : `+${m}`;
}

function __cmdGlobalRenderEfectivoInto(hostEl, kpis){
  if (!hostEl) return;
  hostEl.innerHTML = '';

  const k = (kpis && typeof kpis === 'object') ? kpis : null;
  if (!k || k.enabled == null){
    hostEl.textContent = 'Efectivo: —';
    return;
  }
  if (k.enabled === false){
    hostEl.textContent = 'Efectivo: OFF';
    return;
  }

  // ON: bloque compacto
  const wrap = document.createElement('div');
  wrap.className = 'cmd-gkpi-efc';

  const h = document.createElement('div');
  h.className = 'cmd-gkpi-efc-h';
  h.textContent = 'Efectivo';

  const lines = document.createElement('div');
  lines.className = 'cmd-gkpi-efc-lines';

  const line = (label, val)=>{
    const d = document.createElement('div');
    d.className = 'cmd-gkpi-efc-line';
    d.textContent = `${label}: ${val}`;
    return d;
  };

  const tc = __cmdGlobalFmtMaybeFx(k.tc);
  const si = __cmdGlobalFmtMaybeMoney(k.saldoInicial);
  const ve = __cmdGlobalFmtMaybeMoney(k.ventasEfectivo);
  const inc = __cmdGlobalFmtSignedMoney(k.totalIngresos, 'in');
  const eg = __cmdGlobalFmtSignedMoney(k.totalEgresos, 'out');
  const adj = __cmdGlobalFmtSignedMoney(k.totalAjustes, 'adj');
  const sf = __cmdGlobalFmtMaybeMoney(k.saldoFinal);

  lines.appendChild(line('T/C', tc));
  lines.appendChild(line('Saldo inicial', si));
  lines.appendChild(line('Ventas efectivo', ve));

  const mov = document.createElement('div');
  mov.className = 'cmd-gkpi-efc-line';
  mov.textContent = `Movimientos: ${inc} / ${eg} / ${adj}`;
  lines.appendChild(mov);

  lines.appendChild(line('Saldo final', sf));

  wrap.appendChild(h);
  wrap.appendChild(lines);
  hostEl.appendChild(wrap);
}

function __cmdUpdateGlobalCardUI(eventId, snap, ev){
  try{
    if (!eventId) return;
    if (state.focusMode !== CMD_MODE_GLOBAL) return;

    const card = document.querySelector(`.cmd-global-card[data-eid="${eventId}"]`);
    if (!card) return;

    const a = card.querySelector('.cmd-gkpi[data-kpi="alertas"] .cmd-gkpi-main');
    if (a){
      const n = (snap && snap.alertas && typeof snap.alertas.pendingCount === 'number' && isFinite(snap.alertas.pendingCount))
        ? String(snap.alertas.pendingCount)
        : '—';
      a.textContent = `Alertas: ${n}`;
    }

    const v = card.querySelector('.cmd-gkpi[data-kpi="ventas"] .cmd-gkpi-main');
    if (v){
      const vv = (snap && typeof snap.ventasHoy === 'number' && isFinite(snap.ventasHoy)) ? fmtMoneyNIO(snap.ventasHoy) : '—';
      v.textContent = `Ventas hoy: ${vv}`;
    }

    const efHost = card.querySelector('.cmd-gkpi[data-kpi="efectivo"] .cmd-gkpi-main');
    if (efHost){
      __cmdGlobalRenderEfectivoInto(efHost, snap && snap.efectivo);
    }

    // Expand/collapse: el body se muestra si está expandido (sin depender del checklist).
    const expanded = !!(state.globalExpanded instanceof Set && state.globalExpanded.has(Number(eventId)));
    const body = card.querySelector('.cmd-global-body');
    if (body){
      try{ body.hidden = !expanded; }catch(_){ }
    }

    // Secciones nuevas (UI base): Ventas / Top / Alertas / Recos
    const setSec = (key, valueText, hintText, bodyText)=>{
      const sec = card.querySelector(`.cmd-gsec[data-sec="${key}"]`);
      if (!sec) return;
      const vEl = sec.querySelector('.cmd-gsec-v');
      const hEl = sec.querySelector('.cmd-gsec-hint');
      const bEl = sec.querySelector('.cmd-gsec-body');
      try{ if (bEl) bEl.classList.remove('is-list'); }catch(_){}
      if (vEl) vEl.textContent = (valueText != null && String(valueText).trim()) ? String(valueText) : '—';
      if (hEl) hEl.textContent = (hintText != null && String(hintText).trim()) ? String(hintText) : 'No disponible';
      if (bEl){
        const bt = (bodyText != null) ? String(bodyText) : '';
        if (bt && bt.trim()){
          bEl.textContent = bt;
          bEl.hidden = false;
        } else {
          bEl.textContent = '—';
          bEl.hidden = true;
        }
      }
    };

    // Ventas hoy: si existe, mostrar; si no, placeholder
    const ventasTxt = (snap && typeof snap.ventasHoy === 'number' && isFinite(snap.ventasHoy)) ? fmtMoneyNIO(snap.ventasHoy) : '—';
    const dkHint = __cmdSafeYMD(snap && snap.dayKey) || '';
    setSec('ventas', ventasTxt, (ventasTxt === '—') ? 'No disponible' : (dkHint ? `Hoy: ${dkHint}` : 'Hoy'), null);

    // Top productos (Etapa 4): mostrar SOLO si hay dato (se calcula al expandir; cache por sello).
    {
      let topV = '—';
      let topH = 'Sin datos';
      const dk = dkHint ? String(dkHint) : '';
      if (expanded){
        const list = (snap && Array.isArray(snap.topProducts)) ? snap.topProducts : (snap && snap.topProducts === null ? null : undefined);
        if (Array.isArray(list) && list.length){
          const parts = [];
          const lim = Math.min(3, list.length);
          for (let i=0; i<lim; i++){
            const it = list[i] || {};
            const nm = safeStr(it.name) || 'N/D';
            const q0 = Number(it.qty);
            const q = (isFinite(q0) ? (Number.isInteger(q0) ? q0 : (__cmdRound2(q0) || q0)) : 0);
            parts.push(`${i+1}. ${nm}·${q}`);
          }
          topV = parts.join(' | ');
          topH = dk ? (`Top 3 · ${dk}`) : 'Top 3';
        } else if (Array.isArray(list) && list.length === 0){
          topV = '—';
          topH = dk ? (`Sin ventas hoy · ${dk}`) : 'Sin ventas hoy';
        } else if (list === null){
          topV = '—';
          topH = 'No disponible';
        } else {
          topV = '—';
          topH = 'Sin datos';
        }
      }
      setSec('top', topV, topH, null);
    }

// Alertas accionables (Etapa 5): lista compacta top 3–5 (urgente primero)
{
  const sec = card.querySelector(`.cmd-gsec[data-sec="alertas"]`);
  const vEl = sec ? sec.querySelector('.cmd-gsec-v') : null;
  const hEl = sec ? sec.querySelector('.cmd-gsec-hint') : null;
  const bEl = sec ? sec.querySelector('.cmd-gsec-body') : null;

  const pending = (snap && snap.alertas && typeof snap.alertas.pendingCount === 'number' && isFinite(snap.alertas.pendingCount))
    ? Number(snap.alertas.pendingCount)
    : null;

  if (!expanded){
    const aN = (pending != null) ? String(pending) : '—';
    setSec('alertas', (aN === '—') ? '—' : (`Pendientes: ${aN}`), (aN === '—') ? 'No disponible' : '—', null);
  } else {
    const list = (snap && (snap.__a33AlertasList != null)) ? (Array.isArray(snap.__a33AlertasList) ? snap.__a33AlertasList : []) : null;
    const n = (list && list.length) ? list.length : 0;
    if (vEl) vEl.textContent = (list === null) ? '—' : String(n);
    if (hEl) hEl.textContent = (list === null) ? 'Cargando…' : (n ? `Top ${n} · urgente primero` : 'Sin alertas');
    if (bEl){
      bEl.innerHTML = '';
      bEl.hidden = false;
      bEl.classList.add('is-list');
      if (list === null){
        const em = document.createElement('div');
        em.className = 'cmd-muted';
        em.textContent = '—';
        bEl.appendChild(em);
      } else if (!n){
        const em = document.createElement('div');
        em.className = 'cmd-muted';
        em.textContent = 'Sin alertas';
        bEl.appendChild(em);
      } else {
        for (const it of list){
          const row = document.createElement('div');
          row.className = 'cmd-gsec-item';

          const ic = document.createElement('div');
          ic.className = 'cmd-gsec-item-ic';
          ic.textContent = (it && it.icon != null) ? String(it.icon) : '•';

          const main = document.createElement('div');
          main.className = 'cmd-gsec-item-main';

          const t = document.createElement('div');
          t.className = 'cmd-gsec-item-title';
          t.textContent = (it && it.title != null) ? String(it.title) : '—';

          main.appendChild(t);

          const sub = (it && it.sub != null) ? String(it.sub) : '';
          if (sub && sub.trim()){
            const s2 = document.createElement('div');
            s2.className = 'cmd-gsec-item-sub';
            s2.textContent = sub;
            main.appendChild(s2);
          }

          row.appendChild(ic);
          row.appendChild(main);
          bEl.appendChild(row);
        }
      }
    }
  }
}

// Recomendaciones (Etapa 5): lista corta (1–3)
{
  const sec = card.querySelector(`.cmd-gsec[data-sec="recos"]`);
  const vEl = sec ? sec.querySelector('.cmd-gsec-v') : null;
  const hEl = sec ? sec.querySelector('.cmd-gsec-hint') : null;
  const bEl = sec ? sec.querySelector('.cmd-gsec-body') : null;

  if (!expanded){
    setSec('recos', '—', 'Sin datos', null);
  } else {
    const list = (snap && (snap.__a33RecosList != null)) ? (Array.isArray(snap.__a33RecosList) ? snap.__a33RecosList : []) : null;
    const n = (list && list.length) ? list.length : 0;
    if (vEl) vEl.textContent = (list === null) ? '—' : (n ? String(n) : '—');
    if (hEl) hEl.textContent = (list === null) ? 'Cargando…' : (n ? 'Sugerencias' : 'Sin recomendaciones');
    if (bEl){
      bEl.innerHTML = '';
      bEl.hidden = false;
      bEl.classList.add('is-list');
      if (list === null){
        const em = document.createElement('div');
        em.className = 'cmd-muted';
        em.textContent = '—';
        bEl.appendChild(em);
      } else if (!n){
        const em = document.createElement('div');
        em.className = 'cmd-muted';
        em.textContent = 'Sin recomendaciones';
        bEl.appendChild(em);
      } else {
        for (const r of list){
          const row = document.createElement('div');
          row.className = 'cmd-gsec-item';

          const ic = document.createElement('div');
          ic.className = 'cmd-gsec-item-ic';
          ic.textContent = '💡';

          const main = document.createElement('div');
          main.className = 'cmd-gsec-item-main';

          const t = document.createElement('div');
          t.className = 'cmd-gsec-item-title';
          t.textContent = String(r || '');

          main.appendChild(t);
          row.appendChild(ic);
          row.appendChild(main);
          bEl.appendChild(row);
        }
      }
    }
  }
}

    // Checklist: solo si expandido + hasChecklistItems=true
    const chk = card.querySelector('.cmd-global-checklist');
    if (chk){
      const has = !!(snap && snap.hasChecklistItems === true);
      if (!expanded || !has){
        try{ chk.hidden = true; }catch(_){ }
      } else {
        try{ chk.hidden = false; }catch(_){ }
        const dk = __cmdSafeYMD(snap && snap.checklistDayKey) || '';
        const cur = (chk.dataset && chk.dataset.dk != null) ? String(chk.dataset.dk || '') : '';
        if (cur !== dk){
          try{ if (chk.dataset) chk.dataset.dk = dk || ''; }catch(_){ }
          if (ev){
            try{ renderGlobalChecklistForEvent(chk, ev, snap); }catch(_){ chk.innerHTML = `<div class="cmd-muted">No disponible</div>`; }
          }
        }
      }
    }
  }catch(_){ }
}


function renderGlobalActivesView(){
  const block = $('globalActivesBlock');
  const list = $('globalActivesList');
  if (!block || !list) return;

  if (state.focusMode !== CMD_MODE_GLOBAL){
    try{ block.hidden = true; }catch(_){ }
    return;
  }

  block.hidden = false;

  const items = resolveActiveEvents();

  // Etapa 1: preparar snapshots (solo data). Asíncrono y fail-safe.
  try{ __cmdPrimeGlobalSnapshots(items); }catch(_){ }

  // Performance iPad/PWA: si el set/orden de eventos activos no cambió, NO reconstruir DOM.
  const ids = [];
  try{
    for (const ev of (Array.isArray(items) ? items : [])){
      const id = Number(ev && ev.id);
      if (id && isFinite(id)) ids.push(id);
    }
  }catch(_){ }
  const sig = ids.join(',');

  if (sig && state.__globalListSig === sig && list.children && list.children.length){
    let ok = true;
    try{
      for (const id of ids){
        if (!list.querySelector(`.cmd-global-card[data-eid="${id}"]`)){ ok = false; break; }
      }
    }catch(_){ ok = false; }

    if (ok){
      if (!(state.globalExpanded instanceof Set)) state.globalExpanded = new Set();

      // abrir automáticamente el 1ro (más reciente) solo una vez
      if (!state.__globalAutoOpened && ids.length){
        try{ state.globalExpanded.clear(); state.globalExpanded.add(Number(ids[0])); }catch(_){ }
        state.__globalAutoOpened = true;
      }

      // eliminar cards que ya no existen (fail-safe)
      try{
        const keep = new Set(ids.map(String));
        const cards = list.querySelectorAll('.cmd-global-card');
        for (const c of cards){
          const ce = (c && c.dataset && c.dataset.eid != null) ? String(c.dataset.eid) : '';
          if (ce && !keep.has(ce)){
            try{ c.remove(); }catch(_){ }
          }
        }
      }catch(_){ }

      // actualizar textos/KPIs sin rerender global
      for (const ev of items){
        try{
          if (!ev || ev.id == null) continue;
          const id = Number(ev.id);
          if (!isFinite(id) || !id) continue;
          const card = list.querySelector(`.cmd-global-card[data-eid="${id}"]`);
          if (!card) continue;

          const title = card.querySelector('.cmd-global-title');
          if (title) title.textContent = safeStr(ev.name) || '—';

          const sub = card.querySelector('.cmd-global-sub');
          if (sub){
            const g = safeStr(ev.groupName);
            sub.textContent = g ? ('Grupo: ' + g) : 'Sin grupo';
          }

          // aplicar estado expand/collapse + render checklist si aplica (sin stutter)
          try{ __cmdApplyGlobalCardExpandedState(id); }catch(_){ }

          const snap = (state.__globalSnapshots && typeof state.__globalSnapshots.get === 'function')
            ? (state.__globalSnapshots.get(id) || null)
            : null;
          if (snap){
            try{ __cmdUpdateGlobalCardUI(id, snap, ev); }catch(_){ }
          }
        }catch(_){ }
      }

      return;
    }
  }

  state.__globalListSig = sig || '';

  list.innerHTML = '';
  if (!items.length){
    const empty = document.createElement('div');
    empty.className = 'cmd-global-empty';
    empty.textContent = 'No se detectaron eventos activos (según actividad reciente).';
    list.appendChild(empty);
    return;
  }

  if (!(state.globalExpanded instanceof Set)) state.globalExpanded = new Set();

  // abrir automáticamente el 1ro (más reciente) para que se sienta vivo
  if (!state.__globalAutoOpened){
    try{
      state.globalExpanded.clear();
      state.globalExpanded.add(Number(items[0].id));
    }catch(_){ }
    state.__globalAutoOpened = true;
  }

  for (const ev of items){
    try{
      if (!ev || ev.id == null) continue;
      const id = Number(ev.id);
      if (!isFinite(id) || !id) continue;
      const expanded = state.globalExpanded.has(id);

      const snap = (state.__globalSnapshots && typeof state.__globalSnapshots.get === 'function')
        ? (state.__globalSnapshots.get(id) || null)
        : null;

      const card = document.createElement('div');
      card.className = 'cmd-global-card';
      try{ card.dataset.eid = String(id); }catch(_){ }

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'cmd-global-head';
      head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      head.addEventListener('click', ()=> toggleGlobalCard(id));

      const title = document.createElement('div');
      title.className = 'cmd-global-title';
      title.textContent = safeStr(ev.name) || '—';

      const sub = document.createElement('div');
      sub.className = 'cmd-global-sub';
      const g = safeStr(ev.groupName);
      sub.textContent = g ? ('Grupo: ' + g) : 'Sin grupo';

      const che = document.createElement('div');
      che.className = 'cmd-global-chev';
      // Chevron: glifo fijo; la rotación/estado lo maneja CSS vía aria-expanded.
      che.textContent = '▾';

      // KPI blocks (SIEMPRE visibles): Alertas / Efectivo / Ventas hoy
      const kpis = document.createElement('div');
      kpis.className = 'cmd-global-kpis';

      const mkKpi = (key)=>{
        const box = document.createElement('div');
        box.className = 'cmd-gkpi';
        try{ box.dataset.kpi = String(key); }catch(_){ }
        const main = document.createElement('div');
        main.className = 'cmd-gkpi-main';
        box.appendChild(main);
        kpis.appendChild(box);
        return main;
      };

      const aMain = mkKpi('alertas');
      const aN = (snap && snap.alertas && typeof snap.alertas.pendingCount === 'number' && isFinite(snap.alertas.pendingCount))
        ? String(snap.alertas.pendingCount)
        : '—';
      aMain.textContent = `Alertas: ${aN}`;

      const efMain = mkKpi('efectivo');
      __cmdGlobalRenderEfectivoInto(efMain, snap && snap.efectivo);

      const vMain = mkKpi('ventas');
      const vV = (snap && typeof snap.ventasHoy === 'number' && isFinite(snap.ventasHoy)) ? fmtMoneyNIO(snap.ventasHoy) : '—';
      vMain.textContent = `Ventas hoy: ${vV}`;

      head.appendChild(title);
      head.appendChild(sub);
      head.appendChild(che);
      head.appendChild(kpis);

      const body = document.createElement('div');
      body.className = 'cmd-global-body';

      // UI base (Etapa 2/5): secciones compactas dentro del expandido.
      const sections = document.createElement('div');
      sections.className = 'cmd-global-sections';

      const mkSec = (key, title, vText, hintText, bodyText)=>{
        const s = document.createElement('div');
        s.className = 'cmd-gsec';
        try{ s.dataset.sec = String(key); }catch(_){ }

        const h = document.createElement('div');
        h.className = 'cmd-gsec-h';
        h.textContent = String(title || '');

        const v = document.createElement('div');
        v.className = 'cmd-gsec-v';
        v.textContent = (vText != null) ? String(vText) : '—';

        const hint = document.createElement('div');
        hint.className = 'cmd-muted cmd-gsec-hint';
        hint.textContent = (hintText != null) ? String(hintText) : 'No disponible';

        const b = document.createElement('div');
        b.className = 'cmd-gsec-body';
        if (bodyText != null && String(bodyText).trim()){
          b.textContent = String(bodyText);
          b.hidden = false;
        } else {
          b.textContent = '—';
          b.hidden = true;
        }

        s.appendChild(h);
        s.appendChild(v);
        s.appendChild(hint);
        s.appendChild(b);
        return s;
      };

      // Orden acordado (debajo del bloque existente de Efectivo): Ventas / Top / Alertas / Recos
      sections.appendChild(mkSec('ventas', 'Ventas hoy', '—', 'No disponible', null));
      sections.appendChild(mkSec('top', 'Top productos', '—', 'Sin datos', null));
      sections.appendChild(mkSec('alertas', 'Alertas accionables', '—', 'No disponible', null));
      sections.appendChild(mkSec('recos', 'Recomendaciones', '—', 'Sin datos', null));

      // Checklist (si existe) se renderiza aquí sin borrar las secciones.
      const chk = document.createElement('div');
      chk.className = 'cmd-global-checklist';
      try{ if (chk.dataset) chk.dataset.dk = ''; }catch(_){ }
      chk.hidden = true;

      body.appendChild(sections);
      body.appendChild(chk);

      // Expandido: se muestra SIEMPRE (aunque no exista checklist); checklist se muestra solo si hay items.
      body.hidden = !expanded;

      // Checklist: render solo si expandido + hasChecklistItems=true
      const hasChecklist = !!(snap && snap.hasChecklistItems === true);
      if (expanded && hasChecklist){
        chk.hidden = false;
        try{ if (chk.dataset) chk.dataset.dk = __cmdSafeYMD(snap && snap.checklistDayKey) || ''; }catch(_){ }
        // Importante: NO calcular nada cuando está colapsado.
        try{ renderGlobalChecklistForEvent(chk, ev, snap); }catch(_){ chk.innerHTML = `<div class="cmd-muted">No disponible</div>`; }
      }

      card.appendChild(head);
      card.appendChild(body);
      list.appendChild(card);

      // Si el snapshot llega después, el worker lo actualizará; si ya existe, asegurarlo aquí.
      if (snap){
        try{ __cmdUpdateGlobalCardUI(id, snap, ev); }catch(_){ }
      }
    }catch(_e){
      // Un evento corrupto NO debe tumbar la vista GLOBAL.
      try{
        const card = document.createElement('div');
        card.className = 'cmd-global-card';
        card.innerHTML = `<div class="cmd-global-head" aria-expanded="false"><div class="cmd-global-title">Evento (datos inválidos)</div><div class="cmd-global-sub">No disponible</div><div class="cmd-global-chev">▾</div></div>`;
        list.appendChild(card);
      }catch(_){ }
    }
  }
}

function clearMetricsToDash(){
  setText('salesToday', '—');
  setText('salesTodaySub', '—');
  setText('salesTodayHint', 'No disponible');
  setText('pettyState', '—');
  setText('pettyDayState', '—');
  setText('pettyHint', 'No disponible');
  setText('pettyFx', '—');
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

    const isChecklist = (a && String(a.key || '') === 'checklist-incomplete');

    // Checklist por fases (3 columnas, mínimo): PRE-EVENTO | EVENTO | CIERRE
    if (isChecklist && a && a.checklistPhases && typeof a.checklistPhases === 'object'){
      sub.classList.add('cmd-alert-sub-grid');
      sub.innerHTML = '';

      const ph = a.checklistPhases;
      const phases = (ph && ph.phases && typeof ph.phases === 'object') ? ph.phases : {};
      const ok = (ph && ph.ok === false) ? false : true;

      const lim = (ph && typeof ph.limit === 'number' && isFinite(ph.limit) && ph.limit > 0) ? Math.floor(ph.limit) : 3;

      const makeCol = (label, bucket)=>{
        const col = document.createElement('div');
        col.className = 'cmd-chk-col';

        const hdr = document.createElement('div');
        hdr.className = 'cmd-chk-hdr';

        const name = document.createElement('span');
        name.className = 'cmd-chk-name';
        name.textContent = label;

        const prog = document.createElement('span');
        prog.className = 'cmd-chk-prog';

        if (ok === false){
          prog.textContent = '—';
        } else {
          const done = (bucket && typeof bucket.done === 'number') ? bucket.done : Number(bucket && bucket.done) || 0;
          const total = (bucket && typeof bucket.total === 'number') ? bucket.total : Number(bucket && bucket.total) || 0;
          prog.textContent = `${done}/${total}`;
        }

        hdr.appendChild(name);
        hdr.appendChild(prog);

        const body = document.createElement('div');
        body.className = 'cmd-chk-body';

        if (ok === false){
          body.textContent = (ph && ph.reason) ? String(ph.reason) : 'No disponible';
        } else { 
          const texts = (bucket && Array.isArray(bucket.pendingTexts)) ? bucket.pendingTexts : [];
          const pendingCount = (bucket && typeof bucket.pendingCount === 'number' && isFinite(bucket.pendingCount))
            ? bucket.pendingCount
            : (Array.isArray(texts) ? texts.length : 0);

          if (texts && texts.length){
            const top = texts.slice(0, lim);
            for (const t of top){
              const line = document.createElement('span');
              line.className = 'cmd-chk-item';
              line.textContent = `• ${String(t || '')}`;
              body.appendChild(line);
            }

            const more = (bucket && typeof bucket.moreCount === 'number' && isFinite(bucket.moreCount))
              ? bucket.moreCount
              : Math.max(0, pendingCount - lim);

            if (more > 0){
              const moreLine = document.createElement('span');
              moreLine.className = 'cmd-chk-item cmd-chk-more';
              moreLine.textContent = `+${more} más`;
              body.appendChild(moreLine);
            }
          } else {
            const okLine = document.createElement('span');
            okLine.className = 'cmd-chk-item cmd-chk-ok';
            okLine.textContent = 'Al día ✅';
            body.appendChild(okLine);
          }
        }

        col.appendChild(hdr);
        col.appendChild(body);
        return col;
      };

      const grid = document.createElement('div');
      grid.className = 'cmd-chk-grid';
      grid.appendChild(makeCol('PRE-EVENTO', phases.pre || null));
      grid.appendChild(makeCol('EVENTO', phases.event || null));
      grid.appendChild(makeCol('CIERRE', phases.close || null));

      sub.appendChild(grid);

    } else if (isChecklist && a.sub != null){
      // Checklist (legacy): render por líneas para truncado elegante
      sub.classList.add('cmd-alert-sub-lines');
      const raw = String(a.sub);
      const parts = raw.split('\n').map(x=> String(x ?? '').trim()).filter(Boolean);
      for (const line of (parts.length ? parts : ['—'])){
        const ln = document.createElement('div');
        ln.className = 'cmd-alert-subline';
        ln.textContent = line;
        sub.appendChild(ln);
      }
    } else {
      sub.textContent = (a && a.sub != null) ? String(a.sub) : '';
    }

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
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
      const parsed = A33Storage.sharedGet(ORDERS_LS_KEY, [], 'local');
      if (!parsed) return { ok:true, items:[], reason:'' };
      if (!Array.isArray(parsed)) return { ok:false, items:[], reason:'No disponible' };
      return { ok:true, items: parsed, reason:'' };
    }
  }catch(err){
    console.warn('Centro de Mando: error leyendo pedidos (sharedGet)', err);
  }

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
    const name = uiProdNameCMD(s.productName) || 'N/D';
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


async function computeCashV2Status(ev, dayKey){
  // Nota: FX (T/C) se resuelve SIEMPRE desde el EVENTO ACTIVO (Evento GLOBAL),
  // independientemente de cashV2 ON/OFF. cashV2 sigue siendo la fuente de verdad
  // SOLO para el estado operativo (ABIERTO/CERRADO/SIN ACTIVIDAD).

  if (!ev){
    return { ok:false, enabled:null, isOpen:null, dayState:null, opDayKey:null, fx:null, fxMissing:null, fxKnown:false, status:null, fxSource:'unknown', reason:'No disponible' };
  }

  // 0) FX por evento (canon) — siempre
  const fxInfo = resolveEventFxInfo(ev);
  let fxEvent = (fxInfo && fxInfo.fx != null) ? fxInfo.fx : null;
  let fxSourceEvent = (fxInfo && fxInfo.source) ? String(fxInfo.source) : 'none';

  // 1) Detección (CANON POS): evento.flag -> cache -> default ON
  let en = null;
  try{ en = await resolveCashV2EnabledForEvent(ev); }catch(_){ en = null; }
  const enabled = !!(en && en.enabled === true);

  // Si cashV2 está OFF, igual devolvemos FX (evento) para que CdM lo muestre siempre.
  if (!enabled){
    const fxMissing = !(fxEvent && fxEvent > 0);
    return { ok:true, enabled:false, isOpen:false, dayState:'No aplica', opDayKey:null, fx: fxEvent || null, fxMissing, fxKnown:true, status:null, fxSource: fxSourceEvent, reason:'' };
  }

  const db = state.db;
  if (!db){
    const fxMissing = !(fxEvent && fxEvent > 0);
    return { ok:false, enabled:true, isOpen:null, dayState:null, opDayKey:null, fx: fxEvent || null, fxMissing, fxKnown:true, status:null, fxSource: fxSourceEvent, reason:'No disponible' };
  }

  if (!hasStore(db, 'cashV2')){
    const fxMissing = !(fxEvent && fxEvent > 0);
    return { ok:false, enabled:true, isOpen:null, dayState:null, opDayKey:null, fx: fxEvent || null, fxMissing, fxKnown:true, status:null, fxSource: fxSourceEvent, reason:'No disponible' };
  }

  const eid = Number(ev.id);
  const dk = safeYMD(dayKey);

  // Micro-cache (iPad/PWA): evitar scan repetido por evento.
  // Validación rápida: 1 lectura por key (si tenemos opDayKey+sig), sin recorrer todo el store.
  try{
    const cacheSt = __cmdEnsureMap('__cashV2StatusCache');
    const kSt = `cs|${eid}|${dk}`;
    const hitSt = cacheSt.get(kSt);
    const nowSt = Date.now();
    if (hitSt && hitSt.v){
      // Muy reciente => devolver sin tocar DB
      if ((nowSt - Number(hitSt.t||0)) < 2500){
        return hitSt.v;
      }
      // Validar contra el mismo opDayKey (si existe)
      if (hitSt.opDayKey && hitSt.sig && db && hasStore(db,'cashV2')){
        const key0 = __cmdCashV2Key(eid, String(hitSt.opDayKey||''));
        if (key0){
          const rec0 = await idbGet(db,'cashV2', key0);
          const sigNow = __cmdCashSigFromRec(rec0);
          if (sigNow && sigNow === String(hitSt.sig)){
            try{ hitSt.t = nowSt; cacheSt.set(kSt, hitSt); }catch(_){ }
            return hitSt.v;
          }
        }
      }
    }
  }catch(_){ }

  // Cache por evento (POS): si existe
  const fxCached = readCashV2FxCached(eid);

  // 2) Buscar si existe un día OPEN real (operativo) para este evento.
  let rows = await idbGetAllByIndex(db, 'cashV2', 'by_event', IDBKeyRange.only(eid));
  if (rows === null){
    // Sin índice, fallback controlado
    rows = await idbGetAll(db, 'cashV2');
  }
  if (!Array.isArray(rows)) rows = [];
  if (rows.length > SAFE_SCAN_LIMIT){
    const fxMissing = !(fxEvent && fxEvent > 0);
    return { ok:false, enabled:true, isOpen:null, dayState:null, opDayKey:null, fx: fxEvent || null, fxMissing, fxKnown:true, status:null, fxSource: fxSourceEvent, reason:'No disponible' };
  }

  const filtered = rows.filter(r => r && Number(r.eventId) === eid);

  const normStatus = (v)=>{
    const s = String(v || '').trim().toUpperCase();
    if (s === 'OPEN' || s === 'ABIERTO') return 'OPEN';
    if (s === 'CLOSED' || s === 'CERRADO') return 'CLOSED';
    return '';
  };

  const open = filtered
    .filter(r => normStatus(r.status) === 'OPEN')
    .sort((a,b)=> (Number(b.openTs||0) - Number(a.openTs||0)))[0] || null;

  let rec = null;
  if (open){
    rec = open;
  } else {
    // 3) Si no hay OPEN, mirar el día de HOY (si existe)
    const key = `cash:v2:${eid}:${dk}`;
    rec = await idbGet(db, 'cashV2', key);
    if (!rec){
      const byEvDay = await idbGetAllByIndex(db, 'cashV2', 'by_event_day', IDBKeyRange.only([eid, dk]));
      if (Array.isArray(byEvDay) && byEvDay.length) rec = byEvDay[0];
    }
  }

  // 4) FX efectivo (canon del evento -> cache -> último recurso: fx del día)
  let fxRec = null;
  if (rec){
    fxRec = fxNorm(rec.fx);
  }

  let fxEffective = null;
  let fxSource = 'none';

  if (fxEvent != null){
    fxEffective = fxEvent;
    fxSource = fxSourceEvent || 'event.fx';
  } else if (fxCached != null){
    fxEffective = fxCached;
    fxSource = 'cache';
  } else if (fxRec != null){
    fxEffective = fxRec;
    fxSource = 'cashV2';
  }

  const fxMissing = !(fxEffective && fxEffective > 0);

  if (!rec){
    // Activo, pero aún no hay día operativo en cashV2
    const out = { ok:true, enabled:true, isOpen:false, dayState:'SIN ACTIVIDAD', opDayKey:null, fx: fxEffective || null, fxMissing, fxKnown:true, status:null, fxSource, reason:'' };
    try{
      const cacheSt = __cmdEnsureMap('__cashV2StatusCache');
      const kSt = `cs|${eid}|${dk}`;
      cacheSt.set(kSt, { t: Date.now(), v: out, opDayKey: null, sig: '' });
      while (cacheSt.size > 140){
        try{ cacheSt.delete(cacheSt.keys().next().value); }catch(_){ break; }
      }
    }catch(_){ }
    return out;
  }

  const st = normStatus(rec.status);
  const isOpen = (st === 'OPEN');
  const dayState = isOpen ? 'ABIERTO' : (st === 'CLOSED' ? 'CERRADO' : 'SIN ACTIVIDAD');

  // Día operativo: preferir rec.dayKey; fallback: dk
  let opDayKey = safeYMD(rec.dayKey || '');
  if (!opDayKey){ opDayKey = safeYMD(dk); }

  const out = { ok:true, enabled:true, isOpen, dayState, opDayKey, fx: fxEffective || null, fxMissing, fxKnown:true, status: st || null, fxSource, reason:'' };
  try{
    const cacheSt = __cmdEnsureMap('__cashV2StatusCache');
    const kSt = `cs|${eid}|${dk}`;
    const sig = __cmdCashSigFromRec(rec);
    cacheSt.set(kSt, { t: Date.now(), v: out, opDayKey: opDayKey || null, sig: sig || '' });
    while (cacheSt.size > 140){
      try{ cacheSt.delete(cacheSt.keys().next().value); }catch(_){ break; }
    }
  }catch(_){ }
  return out;
}


async function computeUnclosed7d(ev, todayDayKey){
  // Radar 7d: conteo de días con Efectivo ABIERTO / sin cierre (cashV2).
  // Regla: NO inventar. Si no hay data, decirlo.
  if (!ev) return { ok:true, value:'—', reason:'' };
  const db = state.db;
  if (!db) return { ok:false, value:'—', reason:'No disponible' };

  const en = await resolveCashV2EnabledForEvent(ev);
  if (!en || en.enabled !== true) return { ok:true, value:'—', reason:'' };

  // cashV2 es la fuente de verdad del estado OPEN/CLOSED
  if (!hasStore(db, 'cashV2')) return { ok:false, value:'—', reason:'No disponible' };

  const eid = Number(ev.id);

  let rows = await idbGetAllByIndex(db, 'cashV2', 'by_event', IDBKeyRange.only(eid));
  if (rows === null) rows = await idbGetAll(db, 'cashV2');
  if (!Array.isArray(rows)) rows = [];
  if (rows.length > SAFE_SCAN_LIMIT) return { ok:false, value:'—', reason:'No disponible' };

  const normStatus = (v)=>{
    const s = String(v || '').trim().toUpperCase();
    if (s === 'OPEN' || s === 'ABIERTO') return 'OPEN';
    if (s === 'CLOSED' || s === 'CERRADO') return 'CLOSED';
    return '';
  };

  // Si hay duplicados por día, quedarnos con el más reciente por timestamp.
  const byDay = new Map();
  for (const r of rows){
    if (!r || Number(r.eventId) !== eid) continue;
    const dk = safeYMD(r.dayKey || '');
    if (!dk) continue;
    const ts = Math.max(Number(r.openTs || 0), Number(r.closeTs || 0), Number(r.ts || 0), 0);
    const cur = byDay.get(dk);
    if (!cur || ts >= Number(cur.ts || 0)) byDay.set(dk, { rec: r, ts });
  }

  // Tomar últimos 7 dayKeys disponibles (dayLocks y/o histórico) + cashV2
  const keySet = new Set(Array.from(byDay.keys()));
  const addKey = (k)=>{ const dk = safeYMD(k || ''); if (dk) keySet.add(dk); };

  // dayLocks (cierres) — si existe
  if (hasStore(db, 'dayLocks')){
    try{
      let locks = await idbGetAllByIndex(db, 'dayLocks', 'by_event', IDBKeyRange.only(eid));
      if (locks === null) locks = await idbGetAll(db, 'dayLocks');
      if (Array.isArray(locks)){
        if (locks.length <= SAFE_SCAN_LIMIT){
          for (const r of locks){
            if (!r || Number(r.eventId) !== eid) continue;
            addKey(r.dateKey || r.dayKey);
          }
        }
      }
    }catch(_){ }
  }

  // cashV2 histórico (headers) — si existe
  if (hasStore(db, 'cashv2hist')){
    try{
      let hist = await idbGetAllByIndex(db, 'cashv2hist', 'by_event', IDBKeyRange.only(eid));
      if (hist === null) hist = await idbGetAll(db, 'cashv2hist');
      if (Array.isArray(hist)){
        if (hist.length <= SAFE_SCAN_LIMIT){
          for (const r of hist){
            if (!r || Number(r.eventId) !== eid) continue;
            addKey(r.dayKey);
          }
        }
      }
    }catch(_){ }
  }

  const keys = Array.from(keySet).sort((a,b)=> b.localeCompare(a));
  if (!keys.length) return { ok:true, value:'Sin datos', reason:'' };

  const top7 = keys.slice(0, 7);
  let cntOpen = 0;
  let known = 0;
  for (const dk of top7){
    const wrap = byDay.get(dk);
    if (!wrap || !wrap.rec){
      continue; // no dato real de cashV2 para ese día
    }
    known += 1;
    const st = normStatus(wrap.rec.status);
    if (st === 'OPEN') cntOpen += 1;
  }

  if (known === 0) return { ok:true, value:'Sin datos', reason:'' };
  return { ok:true, value: String(cntOpen), reason:'' };
}

// --- Alertas (motor + Sincronizar)
const ALERT_LABELS = {
  'petty-open': 'Efectivo abierto hoy',
  'fx-missing': 'Falta T/C',
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


function buildActionableAlerts(ev, dayKey, cv2, remindersToday){
  const alerts = [];
  const unavailable = [];

  // 1) Efectivo v2 activo: día ABIERTO (solo con señal real)
  if (cv2 && cv2.enabled === true){
    if (cv2.ok){
      if (cv2.isOpen === true){
        const op = cv2.opDayKey ? String(cv2.opDayKey) : String(dayKey);
        alerts.push({
          key: 'petty-open',
          icon: '🔓',
          title: 'Efectivo abierto hoy',
          sub: `Día operativo: ${op} (ABIERTO)`,
          cta: 'Abrir Resumen',
          tab: 'resumen'
        });
      }
    } else {
      // No se pudo leer el día (no inventar)
      unavailable.push({ key: 'petty-open', label: labelForAlertKey('petty-open'), reason: cv2.reason || 'No disponible' });
    }
  }

  // 2) Falta T/C (evento) — SIEMPRE (independiente de cashV2 ON/OFF)
  if (cv2 && cv2.fxKnown === true){
    if (cv2.fxMissing === true){
      const evName = safeStr(ev && ev.name) || '—';
      const sub = (cv2 && cv2.enabled === true)
        ? (`Día operativo: ${(cv2.opDayKey ? String(cv2.opDayKey) : String(dayKey))} (sin tipo de cambio)`)
        : (`Evento: ${evName} (sin tipo de cambio)`);
      alerts.push({
        key: 'fx-missing',
        icon: '💱',
        title: 'Falta T/C',
        sub,
        cta: 'Abrir Resumen',
        tab: 'resumen'
      });
    }
  } else {
    // No se puede evaluar con seguridad (sin evento / sin datos)
    unavailable.push({ key: 'fx-missing', label: labelForAlertKey('fx-missing'), reason: (cv2 && cv2.reason) ? cv2.reason : 'No disponible' });
  }

  // 3) Checklist hoy por FASE (mínimo, 3 columnas) — fail-safe
  if (hasChecklistEvidenceA33(ev, dayKey)){
    let ph = null;
    try{
      ph = buildChecklistPhasesData(ev, dayKey, { limit: 3 });
    }catch(_){
      ph = { ok:false, phases:{ pre:{done:0,total:0,pendingTexts:[],pendingCount:0,moreCount:0}, event:{done:0,total:0,pendingTexts:[],pendingCount:0,moreCount:0}, close:{done:0,total:0,pendingTexts:[],pendingCount:0,moreCount:0} }, reason:'No disponible', limit:3 };
    }

    const phases = (ph && ph.phases && typeof ph.phases === 'object') ? ph.phases : null;

    // Resumen total (para título): suma de fases
    let totalAll = 0;
    let doneAll = 0;
    let hasPending = false;

    if (ph && ph.ok === false){
      totalAll = 0;
      doneAll = 0;
      hasPending = false;
    } else if (phases){
      const keys = ['pre','event','close'];
      for (const k of keys){
        const b = phases[k];
        if (!b || typeof b !== 'object') continue;
        const t = Number(b.total || 0);
        const d = Number(b.done || 0);
        if (isFinite(t) && t > 0) totalAll += t;
        if (isFinite(d) && d > 0) doneAll += d;
        const pc = Number(b.pendingCount || 0);
        if (pc > 0) hasPending = true;
      }
    }

    const isComplete = (!hasPending) && (totalAll <= 0 || doneAll >= totalAll);
    const title = (ph && ph.ok === false)
      ? 'Checklist'
      : (isComplete ? 'Checklist al día' : 'Checklist hoy incompleto');

    alerts.push({
      key: 'checklist-incomplete',
      icon: '✅',
      title,
      sub: '',
      checklistPhases: (ph && typeof ph === 'object') ? ph : { ok:false, phases:null, reason:'No disponible', limit:3 },
      cta: 'Abrir Checklist',
      tab: 'checklist'
    });
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
      let cv2;
      try{
        cv2 = await computeCashV2Status(ev, dayKey);
      }catch(err){
        let en = null;
        try{ en = await resolveCashV2EnabledForEvent(ev); }catch(_){ en = null; }
        cv2 = { ok:false, enabled: en ? (en.enabled === true) : null, reason:'No disponible' };
      }
      let remToday = null;
      try{ remToday = await readRemindersIndexForDay(state.db, dayKey); }catch(_){ remToday = null; }
      const al = buildActionableAlerts(ev, dayKey, cv2, remToday);
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


function navigateToComprasPlan(){
  try{
    window.location.href = COMPRAS_PLAN_ROUTE;
  }catch(_){ }
}




// POS route resolver (robusto: /pruebas/pos vs /pos, según dónde viva el Centro de Mando)
let __A33_POS_INDEX_HREF = null;
const LS_POS_ROUTE_KEY = 'a33_cmd_pos_index_href_v1';

function a33SuiteBasePathFromHere(){
  const p = String(window.location.pathname || '/');
  // Caso típico: /<root>/pruebas/centro-mando/index.html  -> /<root>/pruebas/
  const i = p.indexOf('/pruebas/');
  if (i >= 0) return p.slice(0, i) + '/pruebas/';

  // Caso típico: /<root>/centro-mando/index.html -> /<root>/
  const j1 = p.indexOf('/centro-mando/');
  const j2 = p.indexOf('/centro_mando/');
  const j = (j1 >= 0 || j2 >= 0) ? Math.max(j1, j2) : -1;
  if (j >= 0) return p.slice(0, j) + '/';

  // Fallback: quitar filename
  return p.replace(/[^/]*$/, '');
}

function a33ProbeUrlOk(url, ms){
  const timeoutMs = (typeof ms === 'number' && isFinite(ms) && ms > 0) ? ms : 650;
  return new Promise((resolve)=>{
    let done = false;
    const t = setTimeout(()=>{ if (!done){ done = true; resolve(null); } }, timeoutMs);
    try{
      fetch(url, { method:'GET', cache:'no-store' })
        .then(r=>{
          if (done) return;
          clearTimeout(t);
          done = true;
          resolve(!!(r && r.ok));
        })
        .catch(()=>{
          if (done) return;
          clearTimeout(t);
          done = true;
          resolve(null);
        });
    }catch(_){
      if (done) return;
      clearTimeout(t);
      done = true;
      resolve(null);
    }
  });
}

async function resolvePosIndexHref(){
  if (__A33_POS_INDEX_HREF) return __A33_POS_INDEX_HREF;

  const base = a33SuiteBasePathFromHere();
  const p = String(window.location.pathname || '/');
  const hasPruebas = (p.indexOf('/pruebas/') >= 0);

  const baseNoPruebas = base.replace(/\/pruebas\/$/, '/');

  // Candidatos (orden por probabilidad, sin inventar rutas raras)
  const candidates = [];
  const push = (u)=>{ if (u && !candidates.includes(u)) candidates.push(u); };

  if (hasPruebas){
    push(base + 'pos/index.html');
    push(baseNoPruebas + 'pos/index.html');
  } else {
    push(base + 'pos/index.html');
    push(base + 'pruebas/pos/index.html');
  }

  // Cache: si ya resolvimos una vez en este mismo entorno, reutilizar (ayuda offline).
  try{
    const cached = localStorage.getItem(LS_POS_ROUTE_KEY);
    if (cached && candidates.includes(cached)){
      __A33_POS_INDEX_HREF = cached;
      return cached;
    }
  }catch(_){ }

  // Si no podemos probar (offline / fetch bloqueado), usamos el primero.
  let chosen = candidates[0] || '../pos/index.html';

  // Probe rápido: si uno responde 200, lo usamos.
  for (const u of candidates){
    const ok = await a33ProbeUrlOk(u, 700);
    if (ok === true){ chosen = u; break; }
  }

  __A33_POS_INDEX_HREF = chosen;
  try{ localStorage.setItem(LS_POS_ROUTE_KEY, chosen); }catch(_){ }
  return chosen;
}
async function navigateToPOS(tab){
  const ev = state.focusEvent;
  if (!ev || !state.db) return;
  try{
    await setMeta(state.db, 'currentEventId', Number(ev.id));
  }catch(_){ }
  // Etapa 11B: bloquear deep-link/ruta legacy hacia Caja Chica (no existe como ruta en POS).
  const t0 = safeStr(tab) || 'vender';
  const t = (t0 === 'caja' || t0 === 'caja-chica' || t0 === 'cajachica' || t0 === 'petty' || t0 === 'pettycash') ? 'vender' : t0;
    const posHref = await resolvePosIndexHref();
  window.location.href = `${posHref}?tab=${encodeURIComponent(t)}`;
}

async function navigateToPOSReminders(){
  const ev = state.focusEvent;
  try{
    if (ev && state.db) await setMeta(state.db, 'currentEventId', Number(ev.id));
  }catch(_){ }
  // Deep-link: POS abre Checklist y hace scroll a la card Recordatorios
    const posHref = await resolvePosIndexHref();
  window.location.href = `${posHref}#checklist-reminders`;
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

async function reloadEventsFromDB(){
  const db = state.db;
  if (!db || !hasStore(db, 'events')){
    state.events = [];
    state.eventsById = new Map();
    return;
  }

  let events = await idbGetAll(db, 'events');
  if (!Array.isArray(events)) events = [];

  const cleaned = events.filter(e=> e && e.id != null);
  cleaned.sort((a,b)=> eventSortKey(b) - eventSortKey(a));

  state.events = cleaned;
  const map = new Map();
  for (const ev of cleaned){
    map.set(Number(ev.id), ev);
  }
  state.eventsById = map;
}

// --- Evento GLOBAL: refresh sin recarga (focus/visibility)
let __CMD_GLOBAL_EVT_TIMER = null;
let __CMD_GLOBAL_EVT_BUSY = false;
let __CMD_GLOBAL_EVT_LASTRUN = 0;
let __CMD_GLOBAL_EVT_LASTFULL = 0;
let __CMD_GLOBAL_EVT_LASTID = null;

function scheduleGlobalEventRefresh(reason){
  try{
    const now = Date.now();
    const elapsed = now - (__CMD_GLOBAL_EVT_LASTRUN || 0);
    const delay = (elapsed < 600) ? 650 : 140;
    if (__CMD_GLOBAL_EVT_TIMER) clearTimeout(__CMD_GLOBAL_EVT_TIMER);
    __CMD_GLOBAL_EVT_TIMER = setTimeout(()=>{
      __CMD_GLOBAL_EVT_TIMER = null;
      void doGlobalEventRefresh(reason);
    }, delay);
  }catch(_){ }
}

async function refreshFocusEventFromDB(){
  try{
    const id = Number(state && state.focusId || 0);
    if (!id) return false;
    if (!state.db || !hasStore(state.db, 'events')) return false;

    const fresh = await idbGet(state.db, 'events', id);
    if (fresh && fresh.id != null){
      if (state.eventsById && typeof state.eventsById.set === 'function') state.eventsById.set(id, fresh);
      state.focusEvent = fresh;
      if (Array.isArray(state.events) && state.events.length){
        const ix = state.events.findIndex(e=> e && Number(e.id) === id);
        if (ix >= 0) state.events[ix] = fresh;
      }
      // Best-effort: si el usuario NO está editando el buscador, mantener nombre actualizado
      try{
        const input = $('eventSearch');
        if (input && document && document.activeElement !== input){
          input.value = safeStr(fresh.name) || '';
        }
      }catch(_){ }
      try{ renderFocusHint(); }catch(_){ }
      try{ renderRadarBasics(); }catch(_){ }
      return true;
    }
  }catch(_){ }
  return false;
}

async function doGlobalEventRefresh(reason){
  if (__CMD_GLOBAL_EVT_BUSY) return;
  __CMD_GLOBAL_EVT_BUSY = true;
  try{
    // Solo actuar cuando la pestaña está visible
    try{
      if (document && document.visibilityState && document.visibilityState !== 'visible') return;
    }catch(_){ }

    // Día actual (por si el usuario regresa después de medianoche)
    const t = todayYMD();
    const dayChanged = !!(t && String(t) !== String(state.today));
    if (dayChanged) state.today = t;

    const db = state.db;
    if (!db || !hasStore(db, 'meta')){
      if (dayChanged && state.focusEvent) await refreshAll();
      __CMD_GLOBAL_EVT_LASTFULL = Date.now();
      return;
    }

    let globalId = null;
    try{ globalId = await getMeta(db, 'currentEventId'); }catch(_){ globalId = null; }
    const gid = Number(globalId || 0) || null;
    if (!gid){
      if (dayChanged && state.focusEvent) await refreshAll();
      __CMD_GLOBAL_EVT_LASTFULL = Date.now();
      return;
    }

    const changed = (Number(state.focusId || 0) !== Number(gid));

    // Si el evento global cambió y no está en el índice local, recargar lista (sin inventar)
    if (changed && (!state.eventsById || !state.eventsById.has(gid))){
      await reloadEventsFromDB();
      try{
        const se = $('eventSearch');
        const q = se ? safeStr(se.value) : '';
        renderEventList(q);
      }catch(_){ }
    }

    if (changed && state.eventsById && state.eventsById.has(gid)){
      await setFocusEvent(gid);
      __CMD_GLOBAL_EVT_LASTID = gid;
      __CMD_GLOBAL_EVT_LASTFULL = Date.now();
      return;
    }
    // Evento igual: al volver desde POS, refrescar (sin recargar) progreso/lista de Checklist y demás
    if (!changed && state.focusEvent){
      const now = Date.now();
      const elapsedFull = now - (__CMD_GLOBAL_EVT_LASTFULL || 0);
      if (elapsedFull > 900){
        // No escribir: solo re-leer el evento del store y re-render
        await refreshFocusEventFromDB();
        await refreshAll();
        __CMD_GLOBAL_EVT_LASTFULL = now;
      }
    }

    __CMD_GLOBAL_EVT_LASTID = gid;
  }catch(e){
  }finally{
    __CMD_GLOBAL_EVT_LASTRUN = Date.now();
    __CMD_GLOBAL_EVT_BUSY = false;
  }
  // Si estamos en modo GLOBAL, refrescar la lista (best-effort)
  try{ if (state.focusMode === CMD_MODE_GLOBAL) renderGlobalActivesView(); }catch(_){ }
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

  // GLOBAL (Activos) — siempre arriba
  try{
    const rowG = document.createElement('div');
    const selectedG = (state.focusMode === CMD_MODE_GLOBAL);
    rowG.className = 'cmd-item cmd-item-global' + (selectedG ? ' cmd-item-selected' : '');
    rowG.innerHTML = `
      <div class="cmd-item-title">${CMD_GLOBAL_LABEL}</div>
      <div class="cmd-item-sub">Vista multi-evento · solo activos</div>
    `;
    rowG.addEventListener('click', ()=> setFocusGlobal());
    list.appendChild(rowG);
  }catch(_){ }

  if (!items.length){
    const empty = document.createElement('div');
    empty.className = 'cmd-item';
    empty.innerHTML = `<div class="cmd-item-title">Sin resultados</div><div class="cmd-item-sub">Prueba otro término.</div>`;
    list.appendChild(empty);
    return;
  }

  for (const ev of items){
    const row = document.createElement('div');
    const selected = (state.focusMode !== CMD_MODE_GLOBAL) && state.focusId != null && Number(state.focusId) === Number(ev.id);
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

async function setFocusEvent(eventId, opts){
  opts = opts || {};
  const id = Number(eventId);
  if (!id) return;

  // Modo: al elegir un evento normal, volver a modo EVENTO
  if (!opts.skipMode){
    state.focusMode = CMD_MODE_EVENT;
    persistFocusMode(CMD_MODE_EVENT);
    applyFocusModeToDOM();
  }
  // Si el índice local no tiene el evento (p. ej., creado/cambiado en Resumen), recargar sin inventar
  if (!state.eventsById || !state.eventsById.has(id)){
    try{ await reloadEventsFromDB(); }catch(_){ }
  }
  if (!state.eventsById || !state.eventsById.has(id)) return;
  state.focusId = id;
  state.focusEvent = state.eventsById.get(id) || null;

  // Refrescar el evento desde DB (por si cashV2Active / fx / nombre cambió)
  try{
    if (state.db && hasStore(state.db, 'events')){
      const fresh = await idbGet(state.db, 'events', id);
      if (fresh && fresh.id != null){
        state.eventsById.set(id, fresh);
        state.focusEvent = fresh;
        // Mantener state.events consistente (best-effort, sin reordenar)
        if (Array.isArray(state.events) && state.events.length){
          const ix = state.events.findIndex(e=> e && Number(e.id) === id);
          if (ix >= 0) state.events[ix] = fresh;
        }
      }
    }
  }catch(_){ }

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
  // FAIL-SAFE: un evento/data corrupta NO debe romper GLOBAL ni el dock.
  try{
  clearMetricsToDash();
  clearOrdersToDash();

  // Recomendaciones (cache Analítica)
  renderRecos();

  const dockExpanded = isDockExpanded();

  // Pedidos (operativo: hoy + mañana) — siempre computar (alertas arriba)
  const ordersCtx = computeOrdersOperative();

  // Recordatorios (solo lectura): próximos 7 días (hoy + 6)
  let remNext7 = null;
  try{
    const start = state && state.today ? String(state.today) : todayYMD();
    const dayKeys = [];
    for (let i=0; i<7; i++) dayKeys.push(ymdAddDays(start, i));
    remNext7 = await readRemindersIndexForRange(state.db, dayKeys);
  }catch(_){
    remNext7 = { ok:false, rows:[], reason:'No disponible', dayKeys:[] };
  }

  // Inventario en riesgo (compacto: solo conteos)
  let invCounts = null;
  try{
    const inv = readInventorySafe();
    invCounts = inv ? computeInvRiskCountsLight(inv) : { ok:false, invTotal:null, invRed:0, invYellow:0 };
  }catch(_){
    invCounts = { ok:false, invTotal:null, invRed:0, invYellow:0 };
  }

  // Compras pendientes (Finanzas → Compras planificación): conteo liviano + sello (para gating)
  let purchasesPending = null;
  let purchasesStamp = 'x';
  try{
    const pcLite = computeFinComprasPendingCountAndStamp();
    purchasesPending = (pcLite && pcLite.ok && typeof pcLite.pendingCountTotal === 'number') ? pcLite.pendingCountTotal : null;
    purchasesStamp = (pcLite && typeof pcLite.stamp === 'string' && pcLite.stamp) ? pcLite.stamp : (purchasesPending == null ? 'x' : ('c' + String(purchasesPending)));
  }catch(_){
    purchasesPending = null;
    purchasesStamp = 'x';
  }

  const remPending = (remNext7 && remNext7.ok && Array.isArray(remNext7.rows)) ? remNext7.rows.filter(x=> !(x && x.done)).length : null;
  const ordersPending = (ordersCtx && typeof ordersCtx.pendingCount === 'number') ? ordersCtx.pendingCount : null;
  const invTotal = (invCounts && invCounts.ok && typeof invCounts.invTotal === 'number') ? invCounts.invTotal : null;
  renderDockCompactCounts({
    orders: ordersPending,
    reminders: remPending,
    purchases: purchasesPending,
    invTotal,
    invRed: invCounts ? invCounts.invRed : 0,
    invYellow: invCounts ? invCounts.invYellow : 0,
  });

  // Render completo SOLO en modo expandido (performance iPad/PWA)
  let ordersOut = { alerts:[], unavailable:[] };
  if (dockExpanded){
    const purchasesSig = (purchasesStamp && typeof purchasesStamp === 'string') ? purchasesStamp : (purchasesPending == null ? 'x' : ('c' + String(purchasesPending)));

    const flagsNow = `d${remindersGetShowDone() ? 1 : 0}|l${invViewState && invViewState.liquidsExpanded ? 1 : 0}|b${invViewState && invViewState.bottlesExpanded ? 1 : 0}|p${purchasesSig}`;
    const countsNow = { orders: ordersPending, reminders: remPending, purchases: purchasesPending, invTotal, invRed: invCounts ? invCounts.invRed : 0, invYellow: invCounts ? invCounts.invYellow : 0 };
    const canSkipFull = !!(dockUI && dockUI.__lastFullAt && ((Date.now() - Number(dockUI.__lastFullAt||0)) < 6000)
      && dockCountsEq(dockUI.__lastFullCounts, countsNow)
      && (dockUI.__lastFullFlags === flagsNow));

    if (!canSkipFull){
      try{ renderRemindersBlock(remNext7); }catch(_){ try{ renderRemindersBlock({ ok:false, rows:[], reason:'No disponible', dayKeys:[] }); }catch(__){ } }
      try{ refreshInvRiskBlock(); }catch(_){ try{ renderInvRiskBlock(null, null); }catch(__){ } }
      try{ ordersOut = renderOrdersOperative(ordersCtx); }catch(_){ ordersOut = { alerts: (ordersCtx && Array.isArray(ordersCtx.alerts)) ? ordersCtx.alerts : [], unavailable: (ordersCtx && Array.isArray(ordersCtx.unavailable)) ? ordersCtx.unavailable : [] }; }
      // Compras: solo cuando está expandido y NO se puede saltar el render (fail-safe)
      try{
        const comprasCtxFull = computeFinComprasPending();
        try{ state.comprasPending = comprasCtxFull; }catch(__){ }
        renderPurchasesBlock(comprasCtxFull);
      }catch(_){
        try{ renderPurchasesBlock({ ok:false, pendingCountTotal:null, pendingProveedores:[], pendingVarias:[], updatedAtISO:'', updatedAtDisplay:'', sourceKey: FIN_COMPRAS_CURRENT_KEY }); }catch(__){ }
      }

      try{
        dockUI.__lastFullAt = Date.now();
        dockUI.__lastFullCounts = { orders: ordersPending, reminders: remPending, purchases: purchasesPending, invTotal, invRed: invCounts ? invCounts.invRed : 0, invYellow: invCounts ? invCounts.invYellow : 0 };
        dockUI.__lastFullFlags = flagsNow;
      }catch(_){ }
    } else {
      // Para alertas: no depende del DOM del dock
      ordersOut = {
        alerts: (ordersCtx && Array.isArray(ordersCtx.alerts)) ? ordersCtx.alerts : [],
        unavailable: (ordersCtx && Array.isArray(ordersCtx.unavailable)) ? ordersCtx.unavailable : [],
      };
    }
  } else {
    ordersOut = {
      alerts: (ordersCtx && Array.isArray(ordersCtx.alerts)) ? ordersCtx.alerts : [],
      unavailable: (ordersCtx && Array.isArray(ordersCtx.unavailable)) ? ordersCtx.unavailable : [],
    };
  }

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

  // Recordatorios de HOY (para alertas accionables: evento enfocado)
  let remToday = null;
  try{
    remToday = await readRemindersIndexForDay(state.db, dk);
  }catch(_){
    remToday = { ok:false, rows:[], reason:'No disponible' };
  }

  // Checklist
  const chk = computeChecklistProgress(ev, dk);
  setText('checklistProgress', chk.text);
  setText('checklistHint', chk.ok ? 'Hoy' : chk.reason);


// Efectivo (estado real desde cashV2)
const cv2 = await computeCashV2Status(ev, dk);
if (cv2.ok && cv2.enabled === false){
  setText('pettyState', 'No aplica');
  setText('pettyDayState', '—');
  setText('pettyHint', 'Efectivo desactivado en este evento.');
  setDisabled('btnGoCaja', true);
} else if (cv2.ok && cv2.enabled === true){
  setText('pettyState', 'Activo');
  setText('pettyDayState', cv2.dayState || '—');
  if (cv2.opDayKey){
    setText('pettyHint', `Día operativo: ${cv2.opDayKey}`);
  } else {
    setText('pettyHint', 'Hoy: sin actividad.');
  }
  setDisabled('btnGoCaja', false);
} else if (cv2.enabled === true){
  // Activo pero no se pudo leer
  setText('pettyState', 'Activo');
  setText('pettyDayState', '—');
  setText('pettyHint', cv2.reason || 'No disponible');
  setDisabled('btnGoCaja', false);
} else {
  setText('pettyState', '—');
  setText('pettyDayState', '—');
  setText('pettyHint', cv2.reason || 'No disponible');
  setDisabled('btnGoCaja', true);
}

// T/C visible (2 dec) — siempre
{
  const fxLine = (cv2 && typeof cv2.fx === 'number' && isFinite(cv2.fx) && cv2.fx > 0)
    ? `T/C: ${fmtFX2(cv2.fx)}`
    : 'T/C: —';
  setText('pettyFx', fxLine);
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
  const al = buildActionableAlerts(ev, dk, cv2, remToday);
  const mergedAlerts = ([]
    .concat((ordersOut && Array.isArray(ordersOut.alerts)) ? ordersOut.alerts : [])
    .concat(Array.isArray(al.alerts) ? al.alerts : []));
  renderAlerts(mergedAlerts.length ? mergedAlerts : null);
  }catch(_){
  }finally{
    // Si estamos en modo GLOBAL, nunca dejar la vista vacía por una excepción.
    try{ if (state && state.focusMode === CMD_MODE_GLOBAL) renderGlobalActivesView(); }catch(__){ }
  }
}



// --- Compras (dock expandido): render tabla (Por proveedor + Compras varias)
function parseNumberLoose(val){
  const raw = safeStr(val);
  if (!raw) return NaN;
  let t = raw.replace(/[^0-9,.\-]/g, '');
  if (!t) return NaN;

  // Soportar coma como decimal (y miles en cualquiera de los dos estilos)
  // Regla: si vienen ambos separadores, el ÚLTIMO define el decimal.
  if (t.includes(',') && t.includes('.')){
    const lastComma = t.lastIndexOf(',');
    const lastDot = t.lastIndexOf('.');
    if (lastComma > lastDot){
      // 1.234,56  => 1234.56
      t = t.replace(/\./g, '').replace(/,/g, '.');
    } else {
      // 1,234.56  => 1234.56
      t = t.replace(/,/g, '');
    }
  }
  // Si sólo viene "," => decimal
  else if (t.includes(',') && !t.includes('.')){
    t = t.replace(/,/g, '.');
  }

  const n = parseFloat(t);
  return (isFinite(n) ? n : NaN);
}

function detectCurrencySymbol(priceStr){
  const s = safeStr(priceStr);
  if (!s) return '';
  const low = s.toLowerCase();
  if (low.includes('c$')) return 'C$';
  if (low.includes('usd')) return 'USD';
  if (s.includes('$')) return '$';
  return '';
}

function fmtMoney2(n){
  try{
    if (!isFinite(n)) return '—';
    return n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }catch(_){
    try{ return String(Math.round(Number(n) * 100) / 100); }catch(__){ return '—'; }
  }
}

function renderPurchasesBlock(pc){
  const msgEl = $('purchasesMsg');
  const sectionsEl = $('purchasesSections');
  const byEl = $('purchasesBySupplier');
  const vaEl = $('purchasesVarias');
  const moreEl = $('purchasesMore');
  const totalEl = $('purchasesTotalLabel');
  if (!msgEl || !sectionsEl || !byEl || !vaEl) return;

  const setHeaderTotal = (txt)=>{
    if (!totalEl) return;
    try{ totalEl.textContent = String(txt || 'Total: C$ —'); }catch(_){ }
  };

  const clear = (el)=>{
    try{
      while (el.firstChild) el.removeChild(el.firstChild);
    }catch(_){
      try{ el.textContent = ''; }catch(__){ }
    }
  };

  clear(byEl);
  clear(vaEl);
  if (moreEl){
    moreEl.hidden = true;
    moreEl.textContent = '';
  }

  const showMsg = (t)=>{
    try{
      msgEl.hidden = false;
      msgEl.textContent = t;
      sectionsEl.hidden = true;
    }catch(_){ }
  };

  const showSections = ()=>{
    try{
      msgEl.hidden = true;
      msgEl.textContent = '';
      sectionsEl.hidden = false;
    }catch(_){ }
  };

  if (!pc || pc.ok !== true || typeof pc.pendingCountTotal !== 'number'){
    setHeaderTotal('Total: C$ —');
    showMsg('No disponible');
    return;
  }

  if (pc.pendingCountTotal === 0){
    setHeaderTotal(`Total: C$${fmtMoney2(0)}`);
    showMsg('Sin compras pendientes');
    return;
  }

  const proveedoresAll = Array.isArray(pc.pendingProveedores) ? pc.pendingProveedores : [];
  const variasAll = Array.isArray(pc.pendingVarias) ? pc.pendingVarias : [];

  // Normalizar "Varios"
  const variasNorm = variasAll.map((line)=>{
    const o = (line && typeof line === 'object') ? line : {};
    const sn = safeStr(o.supplierName);
    return { ...o, supplierName: sn || 'Varios' };
  });

  // Total general (C$) — suma robusta (usa line.total si existe; si no, qty*price)
  try{
    let sum = 0;
    let parsedAny = false;
    const all = proveedoresAll.concat(variasNorm);
    for (const line of all){
      if (!line || typeof line !== 'object') continue;
      let t = parseNumberLoose(line.total);
      if (!isFinite(t)){
        const qn = parseNumberLoose(line.quantity);
        const pn = parseNumberLoose(line.price);
        if (isFinite(qn) && isFinite(pn)) t = qn * pn;
      }
      if (isFinite(t)){
        sum += t;
        parsedAny = true;
      }
    }
    setHeaderTotal(parsedAny ? (`Total: C$${fmtMoney2(sum)}`) : 'Total: C$ —');
  }catch(_){
    setHeaderTotal('Total: C$ —');
  }

  // Límite global
  const MAX_ROWS = 20;

  // Distribución: priorizar proveedores, pero si hay "varias" y proveedores llenan 20,
  // reservar 1 fila para "varias" para que la sección no quede vacía.
  let takeProv = Math.min(proveedoresAll.length, MAX_ROWS);
  let takeVar = Math.min(variasNorm.length, Math.max(0, MAX_ROWS - takeProv));
  if (takeVar === 0 && variasNorm.length > 0 && takeProv > 0){
    takeProv = Math.max(0, MAX_ROWS - 1);
    takeVar = 1;
  }

  const proveedoresShow = proveedoresAll.slice(0, takeProv);
  const variasShow = variasNorm.slice(0, takeVar);
  const shownTotal = proveedoresShow.length + variasShow.length;
  const more = Math.max(0, pc.pendingCountTotal - shownTotal);

  const labels = ['Proveedor', 'Producto', 'Cantidad', 'Total'];

  const mkRow = (cells, isHead=false)=>{
    const row = document.createElement('div');
    row.className = 'cmd-purchases-row' + (isHead ? ' is-head' : '');
    for (let i=0; i<4; i++){
      const cell = document.createElement('div');
      cell.className = 'cmd-purchases-cell' + ((i >= 2) ? ' num' : '');
      cell.setAttribute('data-label', labels[i]);
      cell.textContent = (cells[i] == null || cells[i] === '') ? '—' : String(cells[i]);
      row.appendChild(cell);
    }
    return row;
  };

  const renderTable = (rowsToShow, el, hasAny, defaults={})=>{
    clear(el);
    el.appendChild(mkRow(labels, true));

    if (!hasAny){
      el.appendChild(mkRow(['—', 'Sin pendientes', '—', '—']));
      return;
    }

    if (!Array.isArray(rowsToShow) || rowsToShow.length === 0){
      // Hay pendientes, pero no caben por límite (extremo). Mantener UI clara.
      el.appendChild(mkRow(['—', 'Ver Compras', '—', '—']));
      return;
    }

    for (const line of rowsToShow){
      const supplier = safeStr(line && line.supplierName) || safeStr(defaults.supplier) || '—';
      const product = uiProdNameCMD(line && line.product) || '—';
      const qty = safeStr(line && line.quantity) || '—';

      const cur = detectCurrencySymbol(line && line.total) || detectCurrencySymbol(line && line.price);
      const tn = parseNumberLoose(line && line.total);
      const qn = parseNumberLoose(line && line.quantity);
      const pn = parseNumberLoose(line && line.price);

      let totalStr = '—';
      let tot = NaN;
      if (isFinite(tn)) tot = tn;
      else if (isFinite(qn) && isFinite(pn)) tot = qn * pn;
      if (isFinite(tot)){
        const f = fmtMoney2(tot);
        if (cur === 'C$') totalStr = `C$${f}`;
        else if (cur === '$') totalStr = `$${f}`;
        else if (cur === 'USD') totalStr = `USD ${f}`;
        else totalStr = f;
      }

      el.appendChild(mkRow([supplier, product, qty, totalStr]));
    }
  };

  showSections();
  renderTable(proveedoresShow, byEl, proveedoresAll.length > 0, { supplier: '—' });
  renderTable(variasShow, vaEl, variasNorm.length > 0, { supplier: 'Varios' });

  if (moreEl){
    moreEl.hidden = !(more > 0);
    if (more > 0) moreEl.textContent = `y ${more} más…`;
  }
}


// Refresh SOLO del panel inferior (compacto +, si aplica, panel expandido)
async function refreshDockOnly(){
  // Hardening/Perf: token para cancelar renders si el usuario colapsa/expande rápido.
  const myToken = (dockUI ? (++dockUI.__refreshToken) : Date.now());
  try{ if (dockUI) dockUI.__inflight = true; }catch(_){ }
  try{
    const ordersCtx = computeOrdersOperative();

    // Recordatorios próximos 7 días: conteo (y render si expandido)
    let remNext7 = null;
    try{
      const start = state && state.today ? String(state.today) : todayYMD();
      const dayKeys = [];
      for (let i=0; i<7; i++) dayKeys.push(ymdAddDays(start, i));
      remNext7 = await readRemindersIndexForRange(state.db, dayKeys);
      if (remNext7 && remNext7.ok && Array.isArray(remNext7.rows) && remNext7.rows.length > SAFE_SCAN_LIMIT){
        remNext7 = { ok:false, rows:[], reason:'No disponible', dayKeys: Array.isArray(remNext7.dayKeys) ? remNext7.dayKeys : [] };
      }
    }catch(_){
      remNext7 = { ok:false, rows:[], reason:'No disponible', dayKeys:[] };
    }

    // Inventario en riesgo: conteo liviano
    let invCounts = null;
    try{
      const inv = readInventorySafe();
      invCounts = inv ? computeInvRiskCountsLight(inv) : { ok:false, invTotal:null, invRed:0, invYellow:0 };
    }catch(_){
      invCounts = { ok:false, invTotal:null, invRed:0, invYellow:0 };
    }
    // Compras pendientes (Finanzas → Compras planificación): conteo liviano + sello (para gating)
    // Nota: data completa para tabla SOLO si se requiere render del expandido.
    let purchasesPending = null;
    let purchasesStamp = 'x';
    try{
      const pcLite = computeFinComprasPendingCountAndStamp();
      purchasesPending = (pcLite && pcLite.ok && typeof pcLite.pendingCountTotal === 'number') ? pcLite.pendingCountTotal : null;
      purchasesStamp = (pcLite && typeof pcLite.stamp === 'string' && pcLite.stamp) ? pcLite.stamp : (purchasesPending == null ? 'x' : ('c' + String(purchasesPending)));
    }catch(_){
      purchasesPending = null;
      purchasesStamp = 'x';
    }

    const remPending = (remNext7 && remNext7.ok && Array.isArray(remNext7.rows)) ? remNext7.rows.filter(x=> !(x && x.done)).length : null;
    const ordersPending = (ordersCtx && typeof ordersCtx.pendingCount === 'number') ? ordersCtx.pendingCount : null;
    const invTotal = (invCounts && invCounts.ok && typeof invCounts.invTotal === 'number') ? invCounts.invTotal : null;

    const countsNow = { orders: ordersPending, reminders: remPending, purchases: purchasesPending, invTotal, invRed: invCounts ? invCounts.invRed : 0, invYellow: invCounts ? invCounts.invYellow : 0 };
    renderDockCompactCounts(countsNow);

    // Colapsado: SOLO conteos (sin render pesado)
    if (!isDockExpanded()) return;

    // Si el usuario cambió el estado mientras cargábamos, cancelar
    try{ if (dockUI && dockUI.__refreshToken !== myToken) return; }catch(_){ }
    if (!isDockExpanded()) return;

    const purchasesSig = (purchasesStamp && typeof purchasesStamp === 'string') ? purchasesStamp : (purchasesPending == null ? 'x' : ('c' + String(purchasesPending)));
    const flagsNow = `d${remindersGetShowDone() ? 1 : 0}|l${invViewState && invViewState.liquidsExpanded ? 1 : 0}|b${invViewState && invViewState.bottlesExpanded ? 1 : 0}|p${purchasesSig}`;
    const canSkipFull = !!(dockUI && dockUI.__lastFullAt && ((Date.now() - Number(dockUI.__lastFullAt||0)) < 6000)
      && dockCountsEq(dockUI.__lastFullCounts, countsNow)
      && (dockUI.__lastFullFlags === flagsNow));

    if (canSkipFull) return;

    // Render por sección (fail-safe): un fallo NO rompe el resto.
    try{ renderRemindersBlock(remNext7); }catch(_){ try{ renderRemindersBlock({ ok:false, rows:[], reason:'No disponible', dayKeys:[] }); }catch(__){ } }
    try{ if (dockUI && dockUI.__refreshToken !== myToken) return; }catch(_){ }
    if (!isDockExpanded()) return;

    try{ refreshInvRiskBlock(); }catch(_){ try{ renderInvRiskBlock(null, null); }catch(__){ } }
    try{ if (dockUI && dockUI.__refreshToken !== myToken) return; }catch(_){ }
    if (!isDockExpanded()) return;

    try{ renderOrdersOperative(ordersCtx); }catch(_){ try{ renderOrdersOperative({ ok:false, reason:'No disponible', unavailable: [{ key:'orders', label:'Pedidos', reason:'No disponible' }], alerts:[] }); }catch(__){ } }

    // Compras: data completa solo aquí (cuando NO se puede saltar el render)
    let comprasCtx = null;
    try{
      comprasCtx = computeFinComprasPending();
      try{ state.comprasPending = comprasCtx; }catch(__){ }
    }catch(_){
      comprasCtx = { ok:false, pendingCountTotal:null, pendingProveedores:[], pendingVarias:[], updatedAtISO:'', updatedAtDisplay:'', sourceKey: FIN_COMPRAS_CURRENT_KEY };
      try{ state.comprasPending = comprasCtx; }catch(__){ }
    }
    try{ renderPurchasesBlock(comprasCtx); }catch(_){ try{ renderPurchasesBlock({ ok:false, pendingCountTotal:null, pendingProveedores:[], pendingVarias:[], updatedAtISO:'', updatedAtDisplay:'', sourceKey: FIN_COMPRAS_CURRENT_KEY }); }catch(__){ } }

    try{
      if (dockUI){
        dockUI.__lastFullAt = Date.now();
        dockUI.__lastFullCounts = countsNow;
        dockUI.__lastFullFlags = flagsNow;
      }
    }catch(_){ }
  }catch(_){
  }finally{
    try{ if (dockUI && dockUI.__refreshToken === myToken) dockUI.__inflight = false; }catch(_){ }
  }
}

// --- Init
async function init(){
  // Layout: panel global inferior (no tapar contenido)
  bindGlobalDockSpace();

  // Panel inferior: dock compacto por defecto + toggle chevron
  bindDockChevron();
  setDockExpanded(false);

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

  // Dock compacto: pintar conteos lo antes posible (sin render pesado)
  try{ refreshDockOnly(); }catch(_){ }

  // Inventario: toggles (se mantienen abiertos hasta que el usuario los cierre)
  const tL = $('invLiquidsToggle');
  if (tL){
    tL.addEventListener('click', ()=>{
      invViewState.liquidsExpanded = !invViewState.liquidsExpanded;
      if (isDockExpanded()) refreshInvRiskBlock();
    });
  }
  const tB = $('invBottlesToggle');
  if (tB){
    tB.addEventListener('click', ()=>{
      invViewState.bottlesExpanded = !invViewState.bottlesExpanded;
      if (isDockExpanded()) refreshInvRiskBlock();
    });
  }

  // Inventario: recalcular (sin recargar página)
  const recalcBtn = $('invRiskRecalcBtn');
  if (recalcBtn){
    recalcBtn.addEventListener('click', ()=>{ if (isDockExpanded()) refreshInvRiskBlock(); });
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
  bind('btnGoCaja', 'efectivo');
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

  // Compras: CTA
  const comprasBtn = $('btnGoComprasPlan');
  if (comprasBtn){
    comprasBtn.addEventListener('click', navigateToComprasPlan);
  }

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


// Compras pendientes (Finanzas → Compras planificación): preparar data (sin render en esta etapa)
try{
  state.comprasPending = computeFinComprasPending();
  // Debug suave (opcional): útil para smoke sin UI
  window.__A33_CMD_COMPRAS_PENDING = state.comprasPending;
}catch(_){
  state.comprasPending = { ok:false, pendingCountTotal:null, pendingProveedores:[], pendingVarias:[], updatedAtISO:'', updatedAtDisplay:'', sourceKey: FIN_COMPRAS_CURRENT_KEY };
  try{ window.__A33_CMD_COMPRAS_PENDING = state.comprasPending; }catch(__){ }
}

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
    await reloadEventsFromDB();
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

  // Modo guardado: EVENTO vs GLOBAL
  state.focusMode = loadFocusMode();
  applyFocusModeToDOM();

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
  try{
    if (input){
      if (state.focusMode === CMD_MODE_GLOBAL){
        input.value = CMD_GLOBAL_LABEL;
      } else {
        const fev = state.eventsById && state.eventsById.get ? state.eventsById.get(Number(focusId)) : null;
        input.value = safeStr(fev && fev.name ? fev.name : '');
      }
    }
  }catch(_){ }
  renderEventList('');
  hideEventList();

  // REFRESH SIN RECARGA: si el Evento GLOBAL cambia (en Resumen), CdM se actualiza al volver (focus/visible)
  try{
    if (!state.__globalWatchAttached){
      state.__globalWatchAttached = true;
      window.addEventListener('focus', ()=> scheduleGlobalEventRefresh('focus'));
      window.addEventListener('pageshow', ()=> scheduleGlobalEventRefresh('pageshow'));
      document.addEventListener('visibilitychange', ()=>{
        try{
          if (document.visibilityState === 'visible') scheduleGlobalEventRefresh('visibilitychange');
        }catch(_){ }
      });
    }
  }catch(_){ }

  await setFocusEvent(Number(focusId), { skipMode: true });

  if (state.focusMode === CMD_MODE_GLOBAL){
    setFocusGlobal({ skipPersist: true });
  } else {
    state.focusMode = CMD_MODE_EVENT;
    persistFocusMode(CMD_MODE_EVENT);
    applyFocusModeToDOM();
  }
}

document.addEventListener('DOMContentLoaded', init);
