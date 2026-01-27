(()=>{
  'use strict';

  const DB_NAME = 'a33-pos';
  let db = null;

  const $ = (id)=>document.getElementById(id);

  function ymdFromDate(dt){
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,'0');
    const d = String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  const todayKey = ymdFromDate(new Date());

  async function openDb(){
    if (db) return db;
    db = await new Promise((resolve, reject)=>{
      const req = indexedDB.open(DB_NAME);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        // No definimos stores aquí: el POS es la fuente de verdad del schema.
      };
    });
    return db;
  }

  function hasStore(name){
    try{ return !!(db && db.objectStoreNames && db.objectStoreNames.contains(name)); }
    catch{ return false; }
  }

  function tx(storeNames, mode='readonly'){
    return db.transaction(storeNames, mode);
  }

  function idbGet(store, key){
    return new Promise((resolve, reject)=>{
      const t = tx([store], 'readonly');
      const r = t.objectStore(store).get(key);
      r.onsuccess = ()=> resolve(r.result || null);
      r.onerror = ()=> reject(r.error);
    });
  }

  function idbPut(store, value){
    return new Promise((resolve, reject)=>{
      const t = tx([store], 'readwrite');
      const r = t.objectStore(store).put(value);
      r.onsuccess = ()=> resolve(r.result);
      r.onerror = ()=> reject(r.error);
    });
  }

  function idbGetAll(store){
    return new Promise((resolve, reject)=>{
      const t = tx([store], 'readonly');
      const r = t.objectStore(store).getAll();
      r.onsuccess = ()=> resolve(r.result || []);
      r.onerror = ()=> reject(r.error);
    });
  }

  function idbGetAllByIndex(store, indexName, key){
    return new Promise((resolve, reject)=>{
      const t = tx([store], 'readonly');
      const os = t.objectStore(store);
      if (!os.indexNames.contains(indexName)) return resolve([]);
      const idx = os.index(indexName);
      const r = idx.getAll(key);
      r.onsuccess = ()=> resolve(r.result || []);
      r.onerror = ()=> reject(r.error);
    });
  }

  function fmt(n){
    const v = Number(n || 0);
    return v.toLocaleString('es-NI', { minimumFractionDigits:2, maximumFractionDigits:2 });
  }

  function moneyEquals(a,b){
    const eps = 0.005;
    return Math.abs(Number(a||0) - Number(b||0)) <= eps;
  }

  function sumMovements(day){
    const out = { nio:0, usd:0 };
    const mv = Array.isArray(day?.movements) ? day.movements : [];
    for (const m of mv){
      if (!m) continue;
      const amt = Number(m.amount || 0);
      if (!Number.isFinite(amt) || amt === 0) continue;
      const sign = (m.type === 'entrada') ? 1 : -1;
      if (m.currency === 'USD') out.usd += sign * amt;
      else out.nio += sign * amt;
    }
    return out;
  }

  function readInventarioAlerts(){
    try{
      let inv = null;
      if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
        inv = A33Storage.sharedGet('arcano33_inventario', null, 'local');
      } else {
        const raw = A33Storage.getItem('arcano33_inventario');
        if (!raw) return null;
        inv = JSON.parse(raw);
      }
      if (!inv) return null;
      const liquids = inv?.liquids || {};
      let alerts = 0;
      for (const k of Object.keys(liquids)){
        const it = liquids[k] || {};
        const stock = Number(it.stock || 0);
        const max = Number(it.max || 0);
        if (stock <= 0) { alerts++; continue; }
        if (max > 0){
          const pct = (stock / max) * 100;
          if (pct <= 20) alerts++;
        }
      }
      return { alerts };
    }catch(e){
      return null;
    }
  }

  function rowLine(label, value, { muted=false } = {}){
    const div = document.createElement('div');
    div.className = 'rowline';
    const left = document.createElement('div');
    left.textContent = label;
    const right = document.createElement('div');
    right.innerHTML = muted ? `<span class="muted">${value}</span>` : `<b>${value}</b>`;
    div.append(left, right);
    return div;
  }

  function safeText(el, txt){
    if (!el) return;
    el.textContent = txt;
  }

  function show(el, on){
    if (!el) return;
    el.style.display = on ? '' : 'none';
  }

  function sortRecent(events){
    return (events || []).slice().sort((a,b)=>{
      const ta = Date.parse(a?.createdAt || '') || 0;
      const tb = Date.parse(b?.createdAt || '') || 0;
      if (tb !== ta) return tb - ta;
      return (b?.id||0) - (a?.id||0);
    });
  }

  async function getCurrentEventId(){
    if (!hasStore('meta')) return null;
    const m = await idbGet('meta', 'currentEventId');
    const v = m?.value;
    const id = Number(v || 0);
    return id > 0 ? id : null;
  }

  async function setCurrentEventId(id){
    if (!hasStore('meta')) return;
    await idbPut('meta', { id:'currentEventId', value: id ? Number(id) : null });
  }

  function buildSelect(select, events, selectedId){
    select.innerHTML = '';

    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Selecciona —';
    select.appendChild(opt0);

    for (const ev of events){
      const o = document.createElement('option');
      o.value = String(ev.id);
      o.textContent = ev.groupName ? `${ev.groupName} · ${ev.name}` : (ev.name || `Evento #${ev.id}`);
      if (selectedId && Number(selectedId) === Number(ev.id)) o.selected = true;
      select.appendChild(o);
    }
  }

  async function computeSalesTodayAll(){
    if (!hasStore('sales')) return null;
    const sales = await idbGetAllByIndex('sales', 'by_date', todayKey);
    const total = sales.reduce((a,s)=> a + Number(s?.total || 0), 0);
    return { total: round2(total), count: sales.length };
  }

  function round2(n){
    return Math.round((Number(n||0) + Number.EPSILON) * 100) / 100;
  }

  async function computeEventSales(evId){
    if (!hasStore('sales')) return { todayTotal:null, allTotal:null, todayCash:null, top:[] };

    const all = await idbGetAllByIndex('sales', 'by_event', Number(evId));
    const today = all.filter(s => (s?.date || '') === todayKey);

    const sumToday = today.reduce((a,s)=> a + Number(s?.total || 0), 0);
    const sumAll = all.reduce((a,s)=> a + Number(s?.total || 0), 0);

    const cashToday = today
      .filter(s => (s?.payment || '') === 'efectivo' && !s?.isCourtesy && !s?.isReturn)
      .reduce((a,s)=> a + Number(s?.total || 0), 0);

    const byProd = new Map();
    for (const s of all){
      const name = (s?.productName || '—').trim();
      const cur = byProd.get(name) || 0;
      byProd.set(name, cur + Number(s?.total || 0));
    }
    const top = Array.from(byProd.entries())
      .sort((a,b)=> b[1]-a[1])
      .slice(0,5)
      .map(([name, tot])=>({ name, total: round2(tot) }));

    return {
      todayTotal: round2(sumToday),
      allTotal: round2(sumAll),
      todayCash: round2(cashToday),
      top
    };
  }

  function readChecklistProgress(event, dayKey){
    try{
      const ch = event?.days?.[dayKey]?.checklist;
      const items = ch?.items;
      if (!items || typeof items !== 'object') return null;
      const keys = Object.keys(items);
      if (!keys.length) return null;
      const done = keys.filter(k => !!items[k]).length;
      return { done, total: keys.length };
    }catch{ return null; }
  }

  async function readPetty(eventId){
    if (!hasStore('pettyCash')) return null;
    return await idbGet('pettyCash', Number(eventId));
  }

  function pcDayState(day){
    if (!day) return { label:'Sin registros', tone:'muted' };
    if (day.closedAt) return { label:'Cerrado', tone:'ok' };
    // si hay algo guardado y no cerrado, es abierto
    const hasActivity = !!(day?.initial?.savedAt || day?.finalCount?.savedAt || (Array.isArray(day?.movements) && day.movements.length));
    if (hasActivity) return { label:'Abierto', tone:'warn' };
    return { label:'Sin registros', tone:'muted' };
  }

  function renderPcBlock(target, ev, pc, cashSalesNio){
    target.innerHTML = '';

    if (!ev?.pettyEnabled){
      target.appendChild(rowLine('Estado', 'No aplica (Caja Chica desactivada)', { muted:true }));
      return;
    }

    const day = pc?.days?.[todayKey] || null;
    const state = pcDayState(day);

    const fxRate = day?.fxRate ? Number(day.fxRate) : null;
    const iniNio = Number(day?.initial?.totalNio || 0);
    const iniUsd = Number(day?.initial?.totalUsd || 0);
    const finNio = day?.finalCount?.savedAt ? Number(day?.finalCount?.totalNio || 0) : null;
    const finUsd = day?.finalCount?.savedAt ? Number(day?.finalCount?.totalUsd || 0) : null;

    const mov = sumMovements(day);
    const expNio = iniNio + mov.nio + Number(cashSalesNio || 0);
    const expUsd = iniUsd + mov.usd;
    const diffNio = (finNio == null) ? null : round2(finNio - expNio);
    const diffUsd = (finUsd == null) ? null : round2(finUsd - expUsd);

    target.appendChild(rowLine('Día', `${todayKey} · ${state.label}`, { muted: state.tone==='muted' }));

    if (fxRate && fxRate > 0) target.appendChild(rowLine('Tipo de cambio', `1 US$ = C$ ${fmt(fxRate)}`));
    else target.appendChild(rowLine('Tipo de cambio', '—', { muted:true }));

    target.appendChild(rowLine('Inicial', `C$ ${fmt(iniNio)} · US$ ${fmt(iniUsd)}`));

    target.appendChild(rowLine('Movimientos', `C$ ${fmt(mov.nio)} · US$ ${fmt(mov.usd)}`));

    target.appendChild(rowLine('Ventas efectivo (hoy)', `C$ ${fmt(Number(cashSalesNio||0))}`));

    if (finNio == null && finUsd == null){
      target.appendChild(rowLine('Arqueo final', '— (no guardado)', { muted:true }));
      target.appendChild(rowLine('Cuadra', '—', { muted:true }));
      return;
    }

    target.appendChild(rowLine('Arqueo final', `C$ ${fmt(finNio||0)} · US$ ${fmt(finUsd||0)}`));

    const okNio = (diffNio == null) ? null : moneyEquals(diffNio, 0);
    const okUsd = (diffUsd == null) ? null : moneyEquals(diffUsd, 0);
    const ok = (okNio === null ? true : okNio) && (okUsd === null ? true : okUsd);

    if (ok){
      target.appendChild(rowLine('Cuadra', 'Sí ✅'));
    } else {
      const parts = [];
      if (diffNio != null && !moneyEquals(diffNio,0)) parts.push(`C$ ${fmt(diffNio)}`);
      if (diffUsd != null && !moneyEquals(diffUsd,0)) parts.push(`US$ ${fmt(diffUsd)}`);
      target.appendChild(rowLine('Cuadra', `No (dif: ${parts.join(' · ')})`));
    }

    if (day?.closedAt){
      try{
        const dt = new Date(day.closedAt);
        target.appendChild(rowLine('Cerrado a las', dt.toLocaleString('es-NI')));
      }catch{ target.appendChild(rowLine('Cerrado a las', String(day.closedAt))); }
    }
  }

  function renderSalesBlock(target, sales){
    target.innerHTML = '';
    if (!sales){
      target.appendChild(rowLine('Ventas hoy', '—', { muted:true }));
      target.appendChild(rowLine('Acumulado', '—', { muted:true }));
      return;
    }
    target.appendChild(rowLine('Ventas hoy', `C$ ${fmt(sales.todayTotal || 0)}`));
    target.appendChild(rowLine('Acumulado', `C$ ${fmt(sales.allTotal || 0)}`));
  }

  function renderTop(target, top){
    target.innerHTML = '';
    if (!Array.isArray(top) || !top.length) return;
    for (const it of top){
      const li = document.createElement('li');
      li.innerHTML = `<b>${it.name}</b> <span class="muted">· C$ ${fmt(it.total)}</span>`;
      target.appendChild(li);
    }
  }

  function renderInvBlock(target){
    target.innerHTML = '';
    const inv = readInventarioAlerts();
    if (!inv){
      target.appendChild(rowLine('Alertas', '—', { muted:true }));
      return;
    }
    const txt = inv.alerts === 0 ? 'Sin alertas ✅' : `${inv.alerts} alerta(s)`;
    target.appendChild(rowLine('Alertas (líquidos)', txt));
  }

  async function renderRadar(){
    const host = $('cm-radar');
    if (!host) return;

    host.innerHTML = '';

    // Eventos con día abierto (solo Caja Chica)
    let openCount = null;
    try{
      if (hasStore('events') && hasStore('pettyCash')){
        const evs = await idbGetAll('events');
        let c = 0;
        for (const ev of evs){
          if (!ev?.pettyEnabled) continue;
          const pc = await idbGet('pettyCash', Number(ev.id));
          const day = pc?.days?.[todayKey];
          if (!day) continue;
          if (!day.closedAt && (day?.initial?.savedAt || day?.finalCount?.savedAt || (Array.isArray(day?.movements) && day.movements.length))) c++;
        }
        openCount = c;
      }
    }catch(e){ openCount = null; }

    const inv = readInventarioAlerts();
    const salesToday = await computeSalesTodayAll();

    const k1 = document.createElement('article');
    k1.className = 'card kpi';
    k1.innerHTML = `<p class="kpi-label">Eventos con día abierto</p><p class="kpi-value">${openCount==null ? '—' : String(openCount)}</p><p class="kpi-sub">(Caja Chica · ${todayKey})</p>`;

    const k2 = document.createElement('article');
    k2.className = 'card kpi';
    k2.innerHTML = `<p class="kpi-label">Alertas de inventario</p><p class="kpi-value">${inv ? String(inv.alerts) : '—'}</p><p class="kpi-sub">(líquidos · umbral 20%)</p>`;

    const k3 = document.createElement('article');
    k3.className = 'card kpi';
    const salesLabel = (salesToday ? `C$ ${fmt(salesToday.total)}` : '—');
    const salesSub = (salesToday ? `${salesToday.count} venta(s)` : 'sin datos');
    k3.innerHTML = `<p class="kpi-label">Ventas hoy</p><p class="kpi-value">${salesLabel}</p><p class="kpi-sub">${salesSub}</p>`;

    host.append(k1,k2,k3);
  }

  async function renderFocused(){
    const sel = $('cm-event');
    const meta = $('cm-event-meta');
    const actions = $('cm-actions');
    const detail = $('cm-detail');

    if (!sel) return;

    const id = Number(sel.value || 0);
    if (!id){
      show(meta, true);
      safeText(meta, 'Selecciona un evento para ver su estado.');
      show(actions, false);
      show(detail, false);
      return;
    }

    // Persistir evento enfocado como evento actual del POS
    try{ await setCurrentEventId(id); }catch(e){}

    const ev = await idbGet('events', id);
    const pc = await readPetty(id);
    const sales = await computeEventSales(id);

    const day = pc?.days?.[todayKey] || null;
    const state = ev?.pettyEnabled ? pcDayState(day).label : 'No aplica';

    const chk = readChecklistProgress(ev, todayKey);
    const chkLabel = chk ? `${chk.done}/${chk.total}` : '—';

    show(meta, true);
    meta.innerHTML = `
      <div><b>${ev?.name || 'Evento'}</b> ${ev?.groupName ? `<span class="muted">· ${ev.groupName}</span>` : ''}</div>
      <div class="muted">Día: <b>${todayKey}</b> · Estado: <b>${state}</b> · Checklist: <b>${chkLabel}</b></div>
    `;

    const btnPos = $('cm-go-pos');
    const btnCaja = $('cm-go-caja');

    show(actions, true);
    if (btnPos){
      btnPos.onclick = ()=>{ window.location.href = `../pos/index.html#venta`; };
    }
    if (btnCaja){
      // Etapa 11B: ruta legacy hacia Caja Chica deshabilitada. Caer a POS (venta).
      btnCaja.disabled = true;
      btnCaja.title = 'Sección no disponible';
      btnCaja.onclick = ()=>{ window.location.href = `../pos/index.html#venta`; };
    }

    // Detalle
    show(detail, true);
    safeText($('cm-detail-title'), ev?.groupName ? `${ev.groupName} · ${ev.name}` : (ev?.name || '—'));

    renderPcBlock($('cm-pc'), ev, pc, sales.todayCash);
    renderSalesBlock($('cm-sales'), sales);
    renderTop($('cm-top'), sales.top);
    renderInvBlock($('cm-inv'));
  }

  async function load(){
    const empty = $('cm-empty');
    const err = $('cm-error');

    try{
      await openDb();

      if (!hasStore('events')){
        show(err, true);
        err.textContent = 'No se encontró la base de datos del POS en este navegador. Abre A33 POS al menos una vez y vuelve aquí.';
        show(empty, true);
        return;
      }

      const events = sortRecent(await idbGetAll('events'));

      if (!events.length){
        show(empty, true);
        return;
      }

      show(empty, false);

      const cur = await getCurrentEventId();
      const sel = $('cm-event');

      const defId = (cur && events.some(e=>Number(e.id)===Number(cur))) ? cur : (events[0]?.id || null);
      buildSelect(sel, events, defId);

      // Radar
      await renderRadar();

      // Focus initial
      if (defId) sel.value = String(defId);
      await renderFocused();

      sel.addEventListener('change', ()=>{
        renderFocused().catch(console.error);
      });

    }catch(e){
      console.error(e);
      show(err, true);
      err.textContent = 'Error leyendo datos. Si tienes otra pestaña del POS abierta, intenta cerrarla y recargar.';
      show(empty, true);
    }
  }

  load();
})();
