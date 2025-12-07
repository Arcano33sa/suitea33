// Analítica A33 · Fase 1 + Fase 2 (Costos y Utilidad)
// Solo lectura sobre IndexedDB del POS (a33-pos) y recetas en localStorage.

(function(){
  const DB_NAME = 'a33-pos';
  const DB_VER = 19;
  const RECETAS_KEY = 'arcano33_recetas_v1';

  let db = null;
  let sales = [];
  let events = [];
  let products = [];
  let costosPresentacion = null;
  const INVENTARIO_KEY = 'arcano33_inventario';

  // Últimos agregados calculados (para reusar en cambios de orden)
  let lastFilteredSales = [];
  let lastPresStats = null;
  let lastEventStats = null;
  let lastResumenStats = null;
  let lastAgotamiento = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init(){
    setupTabs();
    setupPeriodFilter();
    setupOrdenEventos();
    setupHorasUI();
    setupAgotamientoUI();
    setupExportButtons();

    try {
      await openDB();
      const [s, e, p] = await Promise.all([
        getAll('sales'),
        getAll('events'),
        getAll('products')
      ]);
      sales = Array.isArray(s) ? s : [];
      events = Array.isArray(e) ? e : [];
      products = Array.isArray(p) ? p : [];

      loadCostosPresentacion();
      recompute();
    } catch (err) {
      console.error('Error al inicializar Analítica', err);
      const errEl = document.getElementById('analytics-error');
      if (errEl) errEl.style.display = 'block';
    }
  }

  function openDB(){
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        return reject(new Error('IndexedDB no disponible'));
      }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onerror = () => reject(req.error || new Error('No se pudo abrir la base de datos'));
      req.onsuccess = () => {
        db = req.result;
        resolve(db);
      };
      req.onupgradeneeded = (e) => {
        // No creamos ni modificamos nada aquí: el esquema lo define el POS.
        console.warn('Analítica: onupgradeneeded llamado. Asegúrate de haber abierto antes el POS para inicializar el esquema.');
        db = e.target.result;
      };
    });
  }

  function getAll(storeName){
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error('DB no inicializada'));
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error || new Error('Error al leer ' + storeName));
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- UI helpers ---

  function setupTabs(){
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        tabs.forEach(b => b.classList.toggle('active', b === btn));
        contents.forEach(sec => {
          sec.classList.toggle('active', sec.id === 'tab-' + target);
        });
      });
    });
  }

  function setupPeriodFilter(){
    const periodSelect = document.getElementById('period-select');
    const customBox = document.getElementById('custom-range');
    const fromInput = document.getElementById('date-from');
    const toInput = document.getElementById('date-to');

    if (!periodSelect) return;

    periodSelect.addEventListener('change', () => {
      const val = periodSelect.value;
      if (val === 'custom') {
        if (customBox) customBox.style.display = 'block';
      } else {
        if (customBox) customBox.style.display = 'none';
      }
      recompute();
    });

    if (fromInput) fromInput.addEventListener('change', recompute);
    if (toInput) toInput.addEventListener('change', recompute);
  }

  function setupOrdenEventos(){
    const selectOrden = document.getElementById('orden-eventos');
    if (!selectOrden) return;
    selectOrden.addEventListener('change', () => {
      if (lastEventStats) updateEventos(lastEventStats);
    });
  }

  function getCurrentRange(){
    const periodSelect = document.getElementById('period-select');
    const fromInput = document.getElementById('date-from');
    const toInput = document.getElementById('date-to');

    const today = new Date();
    let from = null;
    let to = null;

    const val = periodSelect ? periodSelect.value : '30d';
    if (val === 'today') {
      from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      to = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    } else if (val === '7d') {
      to = today;
      from = addDays(today, -6);
    } else if (val === '30d') {
      to = today;
      from = addDays(today, -29);
    } else if (val === '90d') {
      to = today;
      from = addDays(today, -89);
    } else if (val === 'ytd') {
      to = today;
      from = new Date(today.getFullYear(), 0, 1);
    } else if (val === 'all') {
      from = null;
      to = null;
    } else if (val === 'custom') {
      const fromVal = fromInput && fromInput.value ? new Date(fromInput.value + 'T00:00:00') : null;
      const toVal = toInput && toInput.value ? new Date(toInput.value + 'T23:59:59') : null;
      from = fromVal;
      to = toVal;
    }

    return { from, to };
  }

  function addDays(date, delta){
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + delta);
    return d;
  }

  function parseSaleDate(str){
    if (!str) return null;
    const parts = String(str).split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m, d);
  }

  function saleInRange(sale, range){
    const { from, to } = range;
    const d = parseSaleDate(sale.date);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }

  function mapPresentation(productName){
    if (!productName) return null;
    const n = String(productName).toLowerCase();
    if (n.includes('pulso')) return 'pulso';
    if (n.includes('media')) return 'media';
    if (n.includes('djeba')) return 'djeba';
    if (n.includes('litro')) return 'litro';
    if (n.includes('galón') || n.includes('galon')) return 'galon';
    return null;
  }

  function formatCurrency(value){
    const n = Number(value) || 0;
    try {
      return 'C$ ' + n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      return 'C$ ' + n.toFixed(2);
    }
  }

  function formatPercent(value){
    const n = Number(value) || 0;
    return n.toFixed(1) + '%';
  }

  function formatMonthKey(key){
    if (!key) return '-';
    const [y, m] = key.split('-');
    const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const idx = parseInt(m, 10) - 1;
    const label = monthNames[idx] || key;
    return label + ' ' + y;
  }

  // --- Costos desde Calculadora / Recetas ---

  function loadCostosPresentacion(){
    try {
      const raw = localStorage.getItem(RECETAS_KEY);
      if (!raw) {
        costosPresentacion = null;
        return;
      }
      const data = JSON.parse(raw);
      if (data && data.costosPresentacion && typeof data.costosPresentacion === 'object') {
        costosPresentacion = data.costosPresentacion;
      } else {
        costosPresentacion = null;
      }
    } catch (err) {
      console.warn('No se pudieron leer costos de presentaciones desde localStorage', err);
      costosPresentacion = null;
    }
  }

  function getUnitCostByPresId(presId){
    if (!presId) return 0;
    if (!costosPresentacion) return 0;
    const info = costosPresentacion[presId];
    if (!info) return 0;
    const val = typeof info.costoUnidad === 'number' ? info.costoUnidad : 0;
    return val > 0 ? val : 0;
  }

  function getUnitCostForProductName(name){
    const presId = mapPresentation(name);
    if (!presId) return 0;
    return getUnitCostByPresId(presId);
  }

  function getUnitCostForSale(sale){
    if (sale && typeof sale.costPerUnit === 'number' && sale.costPerUnit >= 0) {
      return sale.costPerUnit;
    }
    return getUnitCostForProductName(sale && sale.productName);
  }

  function computeLineMetrics(sale){
    const qtyRaw = Number(sale && sale.qty) || 0;
    const qty = Math.abs(qtyRaw);
    const finalQty = sale && sale.isReturn ? -qty : qty;
    const revenue = Number(sale && sale.total) || 0;
    const unitCost = getUnitCostForSale(sale);
    const lineCost = unitCost * finalQty;
    const lineProfit = revenue - lineCost;
    return { unitCost, finalQty, revenue, lineCost, lineProfit };
  }

  // --- Construcción de agregados ---

  function buildPresentationStats(filteredSales){
    const presAgg = {
      pulso: { id:'pulso', label:'Pulso', unidades:0, ventas:0, costo:0, profit:0 },
      media: { id:'media', label:'Media', unidades:0, ventas:0, costo:0, profit:0 },
      djeba: { id:'djeba', label:'Djeba', unidades:0, ventas:0, costo:0, profit:0 },
      litro: { id:'litro', label:'Litro', unidades:0, ventas:0, costo:0, profit:0 },
      galon: { id:'galon', label:'Galón', unidades:0, ventas:0, costo:0, profit:0 }
    };

    let totalVentas = 0;
    let totalUnits = 0;

    for (const s of filteredSales){
      const { finalQty, revenue, lineCost, lineProfit } = computeLineMetrics(s);
      const presId = mapPresentation(s.productName);
      if (!presId || !presAgg[presId]) continue;

      presAgg[presId].unidades += finalQty;
      presAgg[presId].ventas += revenue;
      presAgg[presId].costo += lineCost;
      presAgg[presId].profit += lineProfit;

      totalVentas += revenue;
      totalUnits += finalQty;
    }

    const rows = [];
    for (const key of Object.keys(presAgg)){
      const agg = presAgg[key];
      const unidades = agg.unidades;
      const ventas = agg.ventas;
      const costo = agg.costo;
      const profit = agg.profit;

      const unitPrice = unidades ? (ventas / unidades) : 0;
      // Si no hay unidades, tratamos de usar el costo configurado en recetas
      const unitCost = unidades ? (costo / (unidades || 1)) : getUnitCostByPresId(agg.id);
      const utilUnit = unitPrice - unitCost;
      const marginUnit = unitPrice ? (utilUnit / unitPrice * 100) : 0;
      const ventasPerc = totalVentas ? (ventas / totalVentas * 100) : 0;

      rows.push({
        id: agg.id,
        label: agg.label,
        unidades,
        ventas,
        costo,
        profit,
        unitPrice,
        unitCost,
        utilUnit,
        marginUnit,
        ventasPerc
      });
    }

    return {
      rows,
      totalVentas,
      totalUnits
    };
  }

  function buildEventStats(filteredSales, events){
    const byEvent = new Map();
    let totalVentasPeriodo = 0;

    for (const s of filteredSales){
      const { finalQty, revenue, lineCost, lineProfit } = computeLineMetrics(s);
      const eventId = s.eventId != null ? s.eventId : 'sin-evento';
      const eventName = s.eventName || 'General';

      if (!byEvent.has(eventId)) {
        byEvent.set(eventId, {
          id: eventId,
          name: eventName,
          ventas: 0,
          costo: 0,
          profit: 0,
          ventasPagadas: 0,
          ticketsPagados: 0,
          botellas: 0,
          closedAt: null,
          eventNameFull: null
        });
      }
      const bucket = byEvent.get(eventId);
      bucket.ventas += revenue;
      bucket.costo += lineCost;
      bucket.profit += lineProfit;
      bucket.botellas += finalQty;
      totalVentasPeriodo += revenue;

      if (revenue > 0) {
        bucket.ventasPagadas += revenue;
        bucket.ticketsPagados += 1;
      }
    }

    // Enriquecer con info de estado desde events[]
    for (const ev of events || []){
      const id = ev.id;
      if (id == null) continue;
      const bucket = byEvent.get(id);
      if (bucket) {
        bucket.closedAt = ev.closedAt;
        bucket.eventNameFull = ev.name;
      }
    }

    const rows = Array.from(byEvent.values());
    // Precalcular margen para cada evento
    for (const ev of rows){
      ev.margin = ev.ventas ? (ev.profit / ev.ventas * 100) : 0;
    }

    return {
      rows,
      totalVentasPeriodo
    };
  }

  // --- Recompute principal ---

  function recompute(){
    const range = getCurrentRange();
    const hasSales = Array.isArray(sales) && sales.length;
    const filteredSales = hasSales ? sales.filter(s => saleInRange(s, range)) : [];

    lastFilteredSales = filteredSales;

    const presStats = buildPresentationStats(filteredSales);
    const eventStats = buildEventStats(filteredSales, events || []);

    lastPresStats = presStats;
    lastEventStats = eventStats;

    const resumenStats = updateResumen(filteredSales, presStats, eventStats);
    updateEventos(eventStats);
    updatePresentaciones(presStats);
    rebuildHorasEventOptions(filteredSales);
    updateHoras();
    updateAgotamiento();
    updateAlertas(presStats, eventStats, resumenStats);
    updateProyecciones(presStats, resumenStats);
  }

  // --- Resumen (incluye rentabilidad mensual y recomendaciones) ---

  function updateResumen(filteredSales, presStats, eventStats){
    const kpiTotalVentas = document.getElementById('kpi-total-ventas');
    const kpiTotalBotellas = document.getElementById('kpi-total-botellas');
    const kpiDetalleBotellas = document.getElementById('kpi-detalle-botellas');
    const kpiEventos = document.getElementById('kpi-eventos');
    const kpiTicket = document.getElementById('kpi-ticket-promedio');

    const kpiTotalCosto = document.getElementById('kpi-total-costo');
    const kpiTotalUtilidad = document.getElementById('kpi-total-utilidad');
    const kpiMargenGlobal = document.getElementById('kpi-margen-global');

    const tbody = document.getElementById('tbody-resumen-mensual');

    if (!tbody) return;

    const byMonth = new Map();
    let totalVentas = 0;
    let totalCosto = 0;
    let totalProfit = 0;
    let totalEventosSet = new Set();
    let sumTicketsPagados = 0;
    let countTicketsPagados = 0;

    const totalPres = { pulso:0, media:0, djeba:0, litro:0, galon:0 };

    for (const s of filteredSales){
      const d = parseSaleDate(s.date);
      if (!d) continue;
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');

      if (!byMonth.has(key)) {
        byMonth.set(key, {
          ventas: 0,
          costo: 0,
          profit: 0,
          events: new Set(),
          pres: { pulso:0, media:0, djeba:0, litro:0, galon:0 },
          sumTicketsPagados: 0,
          countTicketsPagados: 0
        });
      }
      const bucket = byMonth.get(key);

      const { finalQty, revenue, lineCost, lineProfit } = computeLineMetrics(s);
      const presId = mapPresentation(s.productName);

      bucket.ventas += revenue;
      bucket.costo += lineCost;
      bucket.profit += lineProfit;

      totalVentas += revenue;
      totalCosto += lineCost;
      totalProfit += lineProfit;

      if (s.eventId != null) {
        bucket.events.add(s.eventId);
        totalEventosSet.add(s.eventId);
      }

      if (presId && bucket.pres[presId] != null) {
        bucket.pres[presId] += finalQty;
        totalPres[presId] += finalQty;
      }

      if (revenue > 0) {
        bucket.sumTicketsPagados += revenue;
        bucket.countTicketsPagados += 1;
        sumTicketsPagados += revenue;
        countTicketsPagados += 1;
      }
    }

    // Actualizar KPIs globales (ventas / botellas / eventos / ticket)
    const totalBotellasGlobal = Object.values(totalPres).reduce((a,b)=>a+b,0);
    if (kpiTotalVentas) kpiTotalVentas.textContent = formatCurrency(totalVentas);
    if (kpiTotalBotellas) kpiTotalBotellas.textContent = String(totalBotellasGlobal);
    if (kpiEventos) kpiEventos.textContent = String(totalEventosSet.size);
    const ticketPromedioGlobal = countTicketsPagados ? (sumTicketsPagados / countTicketsPagados) : 0;
    if (kpiTicket) kpiTicket.textContent = formatCurrency(ticketPromedioGlobal);

    if (kpiDetalleBotellas) {
      kpiDetalleBotellas.textContent =
        'Pulso ' + (totalPres.pulso||0) + ' · ' +
        'Media ' + (totalPres.media||0) + ' · ' +
        'Djeba ' + (totalPres.djeba||0) + ' · ' +
        'Litro ' + (totalPres.litro||0) + ' · ' +
        'Galón ' + (totalPres.galon||0);
    }

    // KPIs de rentabilidad
    if (kpiTotalCosto) kpiTotalCosto.textContent = formatCurrency(totalCosto);
    if (kpiTotalUtilidad) kpiTotalUtilidad.textContent = formatCurrency(totalProfit);
    const margenGlobal = totalVentas ? (totalProfit / totalVentas * 100) : 0;
    if (kpiMargenGlobal) kpiMargenGlobal.textContent = formatPercent(margenGlobal);

    // Tabla mensual
    tbody.innerHTML = '';
    const sortedKeys = Array.from(byMonth.keys()).sort();

    const labels = [];
    const values = [];

    for (const key of sortedKeys){
      const bucket = byMonth.get(key);
      labels.push(formatMonthKey(key));
      values.push(bucket.ventas);

      const ticketPromMes = bucket.countTicketsPagados ? (bucket.sumTicketsPagados / bucket.countTicketsPagados) : 0;
      const margenMes = bucket.ventas ? (bucket.profit / bucket.ventas * 100) : 0;

      const tr = document.createElement('tr');
      tr.innerHTML = [
        '<td>' + formatMonthKey(key) + '</td>',
        '<td>' + formatCurrency(bucket.ventas) + '</td>',
        '<td>' + formatCurrency(bucket.costo) + '</td>',
        '<td>' + formatCurrency(bucket.profit) + '</td>',
        '<td>' + formatPercent(margenMes) + '</td>',
        '<td>' + (bucket.pres.pulso || 0) + '</td>',
        '<td>' + (bucket.pres.media || 0) + '</td>',
        '<td>' + (bucket.pres.djeba || 0) + '</td>',
        '<td>' + (bucket.pres.litro || 0) + '</td>',
        '<td>' + (bucket.pres.galon || 0) + '</td>',
        '<td>' + bucket.events.size + '</td>',
        '<td>' + formatCurrency(ticketPromMes) + '</td>'
      ].join('');
      tbody.appendChild(tr);
    }

    drawBarChart('chart-mensual-ventas', labels, values, { maxBars: 12 });

    const resumenStats = {
      totalVentas,
      totalCosto,
      totalProfit,
      margenGlobal
    };

    lastResumenStats = resumenStats;

    updateTopProductsKpis(presStats, resumenStats);
    updateRecomendaciones(presStats, eventStats, resumenStats);
    return resumenStats;
  }

  function updateTopProductsKpis(presStats, resumenStats){
    const elTopContrib = document.getElementById('kpi-top-contribucion');
    const elTopMargen = document.getElementById('kpi-top-margen');
    if (!elTopContrib && !elTopMargen) return;

    const rows = presStats && Array.isArray(presStats.rows) ? presStats.rows : [];
    if (!rows.length){
      if (elTopContrib) elTopContrib.textContent = 'Mayor contribución: —';
      if (elTopMargen) elTopMargen.textContent = 'Mejor margen: —';
      return;
    }

    let bestProfitRow = null;
    let bestProfit = -Infinity;

    let bestMarginRow = null;
    let bestMargin = -Infinity;

    for (const row of rows){
      if (row.profit > bestProfit){
        bestProfit = row.profit;
        bestProfitRow = row;
      }
      if (row.marginUnit > bestMargin && row.ventas > 0 && row.unidades > 0){
        bestMargin = row.marginUnit;
        bestMarginRow = row;
      }
    }

    if (elTopContrib){
      if (bestProfitRow && bestProfit > 0){
        elTopContrib.textContent = 'Mayor contribución: ' + bestProfitRow.label + ' (' + formatCurrency(bestProfit) + ')';
      } else {
        elTopContrib.textContent = 'Mayor contribución: —';
      }
    }

    if (elTopMargen){
      if (bestMarginRow && isFinite(bestMargin)){
        elTopMargen.textContent = 'Mejor margen: ' + bestMarginRow.label + ' (' + formatPercent(bestMargin) + ')';
      } else {
        elTopMargen.textContent = 'Mejor margen: —';
      }
    }
  }

  function updateRecomendaciones(presStats, eventStats, resumenStats){
    const list = document.getElementById('recs-rentabilidad');
    if (!list) return;
    list.innerHTML = '';

    const presRows = presStats && Array.isArray(presStats.rows) ? presStats.rows : [];
    const evRows = eventStats && Array.isArray(eventStats.rows) ? eventStats.rows : [];
    const totalVentas = resumenStats && resumenStats.totalVentas ? resumenStats.totalVentas : 0;
    const margenGlobal = resumenStats && typeof resumenStats.margenGlobal === 'number' ? resumenStats.margenGlobal : 0;

    function addRec(text){
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    }

    if (!presRows.length && !evRows.length){
      addRec('Aún no hay datos suficientes para generar recomendaciones. Registra algunas ventas en el POS y vuelve a revisar.');
      return;
    }

    // 1) Evento con mejor margen
    if (evRows.length){
      let bestEv = null;
      let bestMargin = -Infinity;
      for (const ev of evRows){
        if (!ev.ventas || ev.ventas <= 0) continue;
        if (ev.margin > bestMargin){
          bestMargin = ev.margin;
          bestEv = ev;
        }
      }
      if (bestEv && isFinite(bestMargin)){
        const name = bestEv.eventNameFull || bestEv.name || 'General';
        addRec('Evento con mejor margen: ' + name + ' (' + formatPercent(bestMargin) + ').');
      }
    }

    // 2) Presentación con mayor utilidad total
    if (presRows.length){
      let bestProfitRow = null;
      let bestProfit = -Infinity;
      for (const row of presRows){
        if (row.profit > bestProfit){
          bestProfit = row.profit;
          bestProfitRow = row;
        }
      }
      if (bestProfitRow && bestProfit > 0){
        addRec('Presentación con mayor utilidad total: ' + bestProfitRow.label + ' (' + formatCurrency(bestProfit) + ').');
      }
    }

    // 3) Presentación con buenas ventas pero margen bajo
    if (presRows.length && totalVentas > 0){
      const avgVentas = totalVentas / presRows.length;
      const margenUmbralBajo = margenGlobal - 5; // 5 pts por debajo del global
      let candidate = null;

      for (const row of presRows){
        if (row.ventas >= avgVentas && row.marginUnit < margenUmbralBajo){
          if (!candidate || row.ventas > candidate.ventas){
            candidate = row;
          }
        }
      }

      if (candidate){
        addRec('Presentación con buenas ventas pero margen bajo: ' + candidate.label +
          ' (margen ' + formatPercent(candidate.marginUnit) + ', por debajo del promedio). Podría revisarse precio o receta.');
      }
    }

    // 4) Presentación con poca rotación pero buen margen
    if (presRows.length){
      const totalUnits = presStats && presStats.totalUnits ? presStats.totalUnits : 0;
      const avgUnits = totalUnits && presRows.length ? (totalUnits / presRows.length) : 0;
      const margenUmbralAlto = margenGlobal + 5; // 5 pts por encima del global
      let candidate = null;

      for (const row of presRows){
        if (row.unidades > 0 && row.unidades < avgUnits && row.marginUnit > margenUmbralAlto){
          if (!candidate || row.marginUnit > candidate.marginUnit){
            candidate = row;
          }
        }
      }

      if (candidate){
        addRec('Presentación de nicho: ' + candidate.label +
          ' (poca rotación pero buen margen de ' + formatPercent(candidate.marginUnit) + '). Puede ser interesante para promociones selectivas o combos.');
      }
    }

    if (!list.children.length){
      addRec('Los márgenes se ven relativamente equilibrados en este periodo. Sigue monitoreando conforme registres más ventas.');
    }
  }

  // --- Eventos (incluye costo y utilidad por evento) ---

  function updateEventos(eventStats){
    const tbody = document.getElementById('tbody-eventos');
    const selectOrden = document.getElementById('orden-eventos');
    if (!tbody) return;

    const rowsBase = eventStats && Array.isArray(eventStats.rows) ? eventStats.rows : [];
    const totalVentasPeriodo = eventStats ? (eventStats.totalVentasPeriodo || 0) : 0;

    tbody.innerHTML = '';

    if (!rowsBase.length){
      drawBarChart('chart-eventos-ventas', [], [], { horizontal:true });
      drawBarChart('chart-eventos-utilidad', [], [], { horizontal:true });
      return;
    }

    const criterio = selectOrden ? selectOrden.value : 'ventas';
    const rows = rowsBase.slice();

    rows.sort((a,b) => {
      if (criterio === 'botellas') {
        return (b.botellas||0) - (a.botellas||0);
      } else if (criterio === 'ticket') {
        const aT = a.ticketsPagados ? a.ventasPagadas/a.ticketsPagados : 0;
        const bT = b.ticketsPagados ? b.ventasPagadas/b.ticketsPagados : 0;
        return bT - aT;
      } else if (criterio === 'utilidad') {
        return (b.profit||0) - (a.profit||0);
      } else if (criterio === 'margen') {
        return (b.margin||0) - (a.margin||0);
      }
      // ventas
      return (b.ventas||0) - (a.ventas||0);
    });

    const labelsVentas = [];
    const valuesVentas = [];

    // Para gráfico de utilidad usamos un orden independiente (por utilidad)
    const rowsByProfit = rowsBase.slice().sort((a,b) => (b.profit||0) - (a.profit||0));
    const labelsUtilidad = [];
    const valuesUtilidad = [];

    // Tabla
    for (const ev of rows){
      const ticketProm = ev.ticketsPagados ? (ev.ventasPagadas / ev.ticketsPagados) : 0;
      const perc = totalVentasPeriodo ? (ev.ventas / totalVentasPeriodo * 100) : 0;
      const estado = ev.closedAt ? 'Cerrado' : 'Abierto';
      const nombre = ev.eventNameFull || ev.name || 'General';
      const margen = ev.margin || 0;

      const tr = document.createElement('tr');
      tr.innerHTML = [
        '<td>' + escapeHtml(nombre) + '</td>',
        '<td>' + estado + '</td>',
        '<td>' + formatCurrency(ev.ventas) + '</td>',
        '<td>' + formatCurrency(ev.costo) + '</td>',
        '<td>' + formatCurrency(ev.profit) + '</td>',
        '<td>' + formatPercent(margen) + '</td>',
        '<td>' + (ev.botellas || 0) + '</td>',
        '<td>' + formatCurrency(ticketProm) + '</td>',
        '<td>' + formatPercent(perc) + '</td>'
      ].join('');
      tbody.appendChild(tr);
    }

    // Top eventos por ventas (para gráfica 1)
    const rowsByVentas = rowsBase.slice().sort((a,b) => (b.ventas||0) - (a.ventas||0));
    const MAX = 10;
    for (const ev of rowsByVentas.slice(0, MAX)){
      const nombre = ev.eventNameFull || ev.name || 'General';
      labelsVentas.push(nombre);
      valuesVentas.push(ev.ventas);
    }

    // Top eventos por utilidad (para gráfica 2)
    for (const ev of rowsByProfit.slice(0, MAX)){
      const nombre = ev.eventNameFull || ev.name || 'General';
      labelsUtilidad.push(nombre);
      valuesUtilidad.push(ev.profit);
    }

    drawBarChart('chart-eventos-ventas', labelsVentas, valuesVentas, { horizontal:true });
    drawBarChart('chart-eventos-utilidad', labelsUtilidad, valuesUtilidad, { horizontal:true });
  }

  // --- Presentaciones (incluye costo y utilidad por presentación) ---

  function updatePresentaciones(presStats){
    const tbody = document.getElementById('tbody-presentaciones');
    if (!tbody) return;

    const rows = presStats && Array.isArray(presStats.rows) ? presStats.rows : [];
    const totalVentas = presStats ? (presStats.totalVentas || 0) : 0;

    tbody.innerHTML = '';

    if (!rows.length){
      drawBarChart('chart-pres-ventas', [], [], {});
      drawBarChart('chart-pres-margen', [], [], {});
      return;
    }

    const labels = [];
    const valuesVentas = [];
    const valuesMargen = [];

    for (const row of rows){
      if (!row.unidades && !row.ventas && !row.costo && !row.profit) continue;

      const perc = totalVentas ? (row.ventas / totalVentas * 100) : 0;

      const tr = document.createElement('tr');
      tr.innerHTML = [
        '<td>' + row.label + '</td>',
        '<td>' + row.unidades + '</td>',
        '<td>' + formatCurrency(row.unitPrice) + '</td>',
        '<td>' + formatCurrency(row.unitCost) + '</td>',
        '<td>' + formatCurrency(row.utilUnit) + '</td>',
        '<td>' + formatPercent(row.marginUnit) + '</td>',
        '<td>' + formatCurrency(row.ventas) + '</td>',
        '<td>' + formatPercent(perc) + '</td>'
      ].join('');
      tbody.appendChild(tr);

      labels.push(row.label);
      valuesVentas.push(row.ventas);
      valuesMargen.push(row.marginUnit);
    }

    drawBarChart('chart-pres-ventas', labels, valuesVentas, {});
    drawBarChart('chart-pres-margen', labels, valuesMargen, {});
  }

  // --- Utilidades adicionales: inventario y analítica avanzada ---

  function loadInventarioFinished(){
    try {
      const raw = localStorage.getItem(INVENTARIO_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.finished && typeof data.finished === 'object') {
        return data.finished;
      }
    } catch (err) {
      console.warn('Analítica: no se pudo leer inventario terminado desde localStorage', err);
    }
    return null;
  }

  function setupHorasUI(){
    const selEvent = document.getElementById('horas-event-select');
    if (selEvent) {
      selEvent.addEventListener('change', () => updateHoras());
    }
  }

  function rebuildHorasEventOptions(filteredSales){
    const selEvent = document.getElementById('horas-event-select');
    if (!selEvent) return;

    const map = new Map();
    for (const s of filteredSales){
      const id = s.eventId != null ? String(s.eventId) : 'sin-evento';
      const name = s.eventName || 'General';
      if (!map.has(id)) {
        map.set(id, name);
      }
    }

    const prevValue = selEvent.value || 'all';
    selEvent.innerHTML = '';

    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = 'Todos los eventos';
    selEvent.appendChild(optAll);

    for (const [id, name] of map.entries()){
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = name;
      selEvent.appendChild(opt);
    }

    if (Array.from(selEvent.options).some(o => o.value === prevValue)) {
      selEvent.value = prevValue;
    } else {
      selEvent.value = 'all';
    }
  }

  function updateHoras(){
    const tbody = document.getElementById('tbody-horas');
    const resumenEl = document.getElementById('resumen-horas-pico');
    if (!tbody) return;

    const salesList = lastFilteredSales || [];
    const selEvent = document.getElementById('horas-event-select');
    const eventFilter = selEvent ? selEvent.value : 'all';

    const valores = new Array(24).fill(0);
    const unidades = new Array(24).fill(0);
    let totalVentas = 0;

    for (const s of salesList){
      if (!s.time) continue;
      if (eventFilter && eventFilter !== 'all') {
        const id = s.eventId != null ? String(s.eventId) : 'sin-evento';
        if (id !== eventFilter) continue;
      }
      const t = String(s.time);
      const h = parseInt(t.slice(0, 2), 10);
      if (isNaN(h) || h < 0 || h > 23) continue;

      const metrics = computeLineMetrics(s);
      const rev = metrics.revenue;
      const qty = metrics.finalQty;

      valores[h] += rev;
      unidades[h] += qty;
      totalVentas += rev;
    }

    tbody.innerHTML = '';
    const labels = [];

    for (let h = 0; h < 24; h++){
      const labelHora = h.toString().padStart(2, '0') + ':00';
      labels.push(labelHora);
      const v = valores[h];
      const u = unidades[h];
      const perc = totalVentas ? (v / totalVentas * 100) : 0;

      const tr = document.createElement('tr');
      tr.innerHTML = [
        '<td>' + labelHora + '</td>',
        '<td>' + formatCurrency(v) + '</td>',
        '<td>' + u + '</td>',
        '<td>' + formatPercent(perc) + '</td>'
      ].join('');
      tbody.appendChild(tr);
    }

    drawBarChart('chart-horas-ventas', labels, valores, {});

    if (resumenEl) {
      const hasData = valores.some(v => Math.abs(v) > 0.0001);
      if (!hasData) {
        resumenEl.textContent = 'Aún no hay datos suficientes para este rango.';
      } else {
        const indexed = valores.map((v, idx) => ({ v, idx })).filter(o => o.v > 0);
        indexed.sort((a, b) => b.v - a.v);
        const top = indexed.slice(0, 3).map(o => o.idx.toString().padStart(2, '0') + ':00');
        const low = valores
          .map((v, idx) => ({ v, idx }))
          .filter(o => o.v === 0)
          .slice(0, 3)
          .map(o => o.idx.toString().padStart(2, '0') + ':00');

        let msg = '';
        if (top.length) {
          msg += 'Horas pico: ' + top.join(', ') + '. ';
        }
        if (low.length) {
          msg += 'Horas flojas: ' + low.join(', ') + '.';
        }
        if (!msg) {
          msg = 'La distribución por hora es relativamente uniforme en este rango.';
        }
        resumenEl.textContent = msg;
      }
    }
  }

  function setupAgotamientoUI(){
    const ventana = document.getElementById('agotamiento-ventana');
    if (ventana) {
      ventana.addEventListener('change', () => updateAgotamiento());
    }
  }

  function updateAgotamiento(){
    const tbody = document.getElementById('tbody-agotamiento');
    if (!tbody) return;

    const ventanaSelect = document.getElementById('agotamiento-ventana');
    const daysWindow = ventanaSelect ? (parseInt(ventanaSelect.value, 10) || 30) : 30;

    const finished = loadInventarioFinished();
    const presList = [
      { id: 'pulso', label: 'Pulso 250 ml' },
      { id: 'media', label: 'Media 375 ml' },
      { id: 'djeba', label: 'Djeba 750 ml' },
      { id: 'litro', label: 'Litro 1000 ml' },
      { id: 'galon', label: 'Galón 3800 ml' }
    ];

    const today = new Date();
    const from = addDays(today, -(daysWindow - 1));
    const to = today;

    const ventasWindow = (sales || []).filter(s => {
      const d = parseSaleDate(s.date);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });

    const consumoPorPres = { pulso: 0, media: 0, djeba: 0, litro: 0, galon: 0 };
    for (const s of ventasWindow){
      const presId = mapPresentation(s.productName);
      if (!presId || !(presId in consumoPorPres)) continue;
      const metrics = computeLineMetrics(s);
      consumoPorPres[presId] += metrics.finalQty;
    }

    tbody.innerHTML = '';
    const rows = [];

    for (const pres of presList){
      const stockActual = finished && finished[pres.id] && typeof finished[pres.id].stock === 'number'
        ? finished[pres.id].stock
        : 0;

      const totalUnidades = consumoPorPres[pres.id] || 0;
      const diasVentana = daysWindow || 1;
      const promedioDia = totalUnidades > 0 ? (totalUnidades / diasVentana) : 0;

      let diasAgotar;
      if (!stockActual || !promedioDia) {
        diasAgotar = null;
      } else {
        diasAgotar = stockActual / promedioDia;
      }

      let estado = 'sin-datos';
      if (diasAgotar == null) {
        if (stockActual > 0 && totalUnidades === 0) {
          estado = 'ok';
        } else {
          estado = 'sin-datos';
        }
      } else if (diasAgotar <= 3) {
        estado = 'critico';
      } else if (diasAgotar <= 7) {
        estado = 'advertencia';
      } else {
        estado = 'ok';
      }

      rows.push({
        id: pres.id,
        label: pres.label,
        stock: stockActual,
        promedioDia,
        diasAgotar,
        estado
      });

      const estadoLabel =
        estado === 'critico' ? 'Crítico' :
        estado === 'advertencia' ? 'Advertencia' :
        estado === 'ok' ? 'OK' :
        'Sin datos';

      const claseEstado =
        estado === 'critico' ? 'alert-critical' :
        estado === 'advertencia' ? 'alert-warning' :
        estado === 'ok' ? 'alert-ok' : 'alert-neutral';

      const tr = document.createElement('tr');
      tr.innerHTML = [
        '<td>' + pres.label + '</td>',
        '<td>' + stockActual + '</td>',
        '<td>' + (promedioDia ? promedioDia.toFixed(2) : '—') + '</td>',
        '<td>' + (diasAgotar != null ? diasAgotar.toFixed(1) : '—') + '</td>',
        '<td><span class="alert-pill ' + claseEstado + '">' + estadoLabel + '</span></td>'
      ].join('');
      tbody.appendChild(tr);
    }

    lastAgotamiento = rows;
  }

  function updateAlertas(presStats, eventStats, resumenStats){
    const list = document.getElementById('panel-alertas');
    if (!list) return;

    list.innerHTML = '';

    const presRows = presStats && Array.isArray(presStats.rows) ? presStats.rows : [];
    const evRows = eventStats && Array.isArray(eventStats.rows) ? eventStats.rows : [];
    const agotRows = Array.isArray(lastAgotamiento) ? lastAgotamiento : [];
    const margenGlobal = resumenStats && typeof resumenStats.margenGlobal === 'number' ? resumenStats.margenGlobal : 0;

    function addItem(type, text){
      const li = document.createElement('li');
      li.textContent = text;
      li.classList.add('alert-item');
      if (type === 'ok') li.classList.add('alert-ok');
      else if (type === 'warn') li.classList.add('alert-warning');
      else if (type === 'critico') li.classList.add('alert-critical');
      list.appendChild(li);
    }

    let hasAlert = false;

    // Riesgos de agotamiento
    for (const row of agotRows){
      if (row.estado === 'critico'){
        addItem('critico', 'Riesgo crítico de agotamiento: ' + row.label + ' podría agotarse en ' +
          (row.diasAgotar != null ? row.diasAgotar.toFixed(1) : '?') + ' días si se mantiene el ritmo actual.');
        hasAlert = true;
      } else if (row.estado === 'advertencia'){
        addItem('warn', 'Atención: ' + row.label + ' tiene stock limitado para aproximadamente ' +
          (row.diasAgotar != null ? row.diasAgotar.toFixed(1) : '?') + ' días.');
        hasAlert = true;
      }
    }

    // Presentaciones con margen bajo
    if (presRows.length && margenGlobal){
      for (const row of presRows){
        if (row.ventas > 0 && row.marginUnit < (margenGlobal - 5)){
          addItem('warn', 'Margen bajo en ' + row.label + ': ' + formatPercent(row.marginUnit) +
            ' (por debajo del promedio).');
          hasAlert = true;
        }
      }
    }

    // Eventos de alto volumen pero poco margen
    if (evRows.length && margenGlobal){
      let maxVentas = 0;
      for (const ev of evRows){
        if (ev.ventas > maxVentas) maxVentas = ev.ventas;
      }
      for (const ev of evRows){
        const nombre = ev.eventNameFull || ev.name || 'General';
        const esAltoVol = maxVentas > 0 && ev.ventas >= maxVentas * 0.4;
        if (esAltoVol && ev.margin < (margenGlobal - 5)){
          addItem('warn', 'Evento de alto volumen pero poco margen: ' + nombre +
            ' (' + formatPercent(ev.margin) + ', ventas ' + formatCurrency(ev.ventas) + ').');
          hasAlert = true;
        }
      }
    }

    if (!hasAlert){
      addItem('ok', 'No se detectan alertas críticas en este periodo. Sigue monitoreando tus ventas y márgenes.');
    }
  }

  function updateProyecciones(presStats, resumenStats){
    const tbody = document.getElementById('tbody-proyecciones-pres');
    const resumenEl = document.getElementById('proy-resumen');

    const rows = presStats && Array.isArray(presStats.rows) ? presStats.rows : [];
    const filtered = lastFilteredSales || [];

    let days = 0;
    const range = getCurrentRange();

    if (range.from && range.to){
      const start = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
      const end = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());
      const ms = end - start;
      days = Math.floor(ms / 86400000) + 1;
    } else if (filtered.length){
      let minD = null;
      let maxD = null;
      for (const s of filtered){
        const d = parseSaleDate(s.date);
        if (!d) continue;
        if (!minD || d < minD) minD = d;
        if (!maxD || d > maxD) maxD = d;
      }
      if (minD && maxD){
        const start = new Date(minD.getFullYear(), minD.getMonth(), minD.getDate());
        const end = new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate());
        const ms = end - start;
        days = Math.floor(ms / 86400000) + 1;
      }
    }

    if (!days || days < 1) days = 1;

    const totalVentas = resumenStats && typeof resumenStats.totalVentas === 'number'
      ? resumenStats.totalVentas
      : 0;
    const avgDailySales = totalVentas / days;
    const horizonDays = 30;
    const projTotalVentas = avgDailySales * horizonDays;

    if (tbody){
      tbody.innerHTML = '';
      for (const row of rows){
        if (!row.unidades && !row.ventas) continue;
        const unidadesDia = row.unidades / days;
        const unidadesProy = unidadesDia * horizonDays;
        const precioUnit = row.unitPrice && row.unitPrice > 0
          ? row.unitPrice
          : (row.ventas && row.unidades ? (row.ventas / row.unidades) : 0);
        const ventasProy = unidadesProy * precioUnit;

        const tr = document.createElement('tr');
        tr.innerHTML = [
          '<td>' + row.label + '</td>',
          '<td>' + (unidadesDia ? unidadesDia.toFixed(2) : '—') + '</td>',
          '<td>' + (unidadesProy ? unidadesProy.toFixed(1) : '—') + '</td>',
          '<td>' + (ventasProy ? formatCurrency(ventasProy) : '—') + '</td>'
        ].join('');
        tbody.appendChild(tr);
      }
    }

    if (resumenEl){
      if (!filtered.length || !totalVentas){
        resumenEl.textContent = 'Aún no hay datos suficientes en este rango para estimar proyecciones. Registra más ventas en el POS.';
      } else {
        resumenEl.textContent =
          'Basado en aproximadamente ' + days + ' día(s) de actividad en el rango seleccionado, podrías vender alrededor de ' +
          formatCurrency(projTotalVentas) + ' en los próximos ' + horizonDays +
          ' días si se mantiene el comportamiento actual.';
      }
    }
  }

  function setupExportButtons(){
    const bRes = document.getElementById('btn-export-resumen');
    const bEvt = document.getElementById('btn-export-eventos');
    const bPres = document.getElementById('btn-export-presentaciones');

    if (bRes) bRes.addEventListener('click', exportResumenCsv);
    if (bEvt) bEvt.addEventListener('click', exportEventosCsv);
    if (bPres) bPres.addEventListener('click', exportPresentacionesCsv);
  }

  function downloadCsv(filename, rows){
    if (!rows || !rows.length) return;
    const lines = rows.map(cols =>
      cols.map(v => {
        if (v == null) return '';
        const s = String(v);
        if (s.includes('"') || s.includes(',') || s.includes('\\n')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }).join(',')
    );
    const blob = new Blob([lines.join('\\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function exportResumenCsv(){
    const filtered = lastFilteredSales || [];
    if (!filtered.length){
      alert('No hay datos en el rango seleccionado para exportar.');
      return;
    }

    let totalVentas = 0;
    let totalCosto = 0;
    let totalProfit = 0;
    const byMonth = new Map();

    for (const s of filtered){
      const d = parseSaleDate(s.date);
      if (!d) continue;
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (!byMonth.has(key)){
        byMonth.set(key, { ventas: 0, costo: 0, profit: 0 });
      }
      const bucket = byMonth.get(key);
      const metrics = computeLineMetrics(s);
      bucket.ventas += metrics.revenue;
      bucket.costo += metrics.lineCost;
      bucket.profit += metrics.lineProfit;

      totalVentas += metrics.revenue;
      totalCosto += metrics.lineCost;
      totalProfit += metrics.lineProfit;
    }

    const margenGlobal = totalVentas ? (totalProfit / totalVentas * 100) : 0;

    const rows = [];
    rows.push(['Tipo', 'Métrica', 'Valor']);
    rows.push(['KPI', 'Ventas totales', totalVentas.toFixed(2)]);
    rows.push(['KPI', 'Costo total', totalCosto.toFixed(2)]);
    rows.push(['KPI', 'Utilidad total', totalProfit.toFixed(2)]);
    rows.push(['KPI', 'Margen global (%)', margenGlobal.toFixed(2)]);

    rows.push([]);
    rows.push(['Mes', 'Ventas (C$)', 'Costo (C$)', 'Utilidad (C$)', 'Margen %']);

    const keys = Array.from(byMonth.keys()).sort();
    for (const key of keys){
      const bucket = byMonth.get(key);
      const margen = bucket.ventas ? (bucket.profit / bucket.ventas * 100) : 0;
      rows.push([
        formatMonthKey(key),
        bucket.ventas.toFixed(2),
        bucket.costo.toFixed(2),
        bucket.profit.toFixed(2),
        margen.toFixed(2)
      ]);
    }

    downloadCsv('analitica_resumen.csv', rows);
  }

  function exportEventosCsv(){
    const stats = lastEventStats;
    if (!stats || !Array.isArray(stats.rows) || !stats.rows.length){
      alert('No hay datos de eventos en el rango seleccionado.');
      return;
    }

    const rows = [];
    rows.push(['Evento', 'Estado', 'Ventas (C$)', 'Costo (C$)', 'Utilidad (C$)', 'Margen %', 'Botellas', 'Ticket promedio', '% del total']);
    const totalVentas = stats.totalVentasPeriodo || 0;

    for (const ev of stats.rows){
      const ticketProm = ev.ticketsPagados ? (ev.ventasPagadas / ev.ticketsPagados) : 0;
      const perc = totalVentas ? (ev.ventas / totalVentas * 100) : 0;
      const estado = ev.closedAt ? 'Cerrado' : 'Abierto';
      const nombre = ev.eventNameFull || ev.name || 'General';
      const margen = ev.margin || 0;
      rows.push([
        nombre,
        estado,
        (ev.ventas || 0).toFixed(2),
        (ev.costo || 0).toFixed(2),
        (ev.profit || 0).toFixed(2),
        margen.toFixed(2),
        ev.botellas || 0,
        ticketProm.toFixed(2),
        perc.toFixed(2)
      ]);
    }

    downloadCsv('analitica_eventos.csv', rows);
  }

  function exportPresentacionesCsv(){
    const stats = lastPresStats;
    if (!stats || !Array.isArray(stats.rows) || !stats.rows.length){
      alert('No hay datos de presentaciones en el rango seleccionado.');
      return;
    }

    const rows = [];
    rows.push(['Presentación', 'Unidades netas', 'Precio unitario prom. (C$)', 'Costo unitario est. (C$)', 'Utilidad unitaria (C$)', 'Margen unitario %', 'Ventas totales (C$)', '% de ventas']);
    const totalVentas = stats.totalVentas || 0;

    for (const row of stats.rows){
      const perc = totalVentas ? (row.ventas / totalVentas * 100) : 0;
      rows.push([
        row.label,
        row.unidades,
        Number(row.unitPrice || 0).toFixed(2),
        Number(row.unitCost || 0).toFixed(2),
        Number(row.utilUnit || 0).toFixed(2),
        Number(row.marginUnit || 0).toFixed(2),
        Number(row.ventas || 0).toFixed(2),
        perc.toFixed(2)
      ]);
    }

    downloadCsv('analitica_presentaciones.csv', rows);
  }

  // --- Gráficas simples en canvas ---

  function drawBarChart(canvasId, labels, values, opts){
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const maxBars = opts && opts.maxBars ? opts.maxBars : null;
    let dataLabels = labels.slice();
    let dataValues = values.slice();

    if (maxBars && dataValues.length > maxBars){
      dataLabels = dataLabels.slice(-maxBars);
      dataValues = dataValues.slice(-maxBars);
    }

    const width = canvas.clientWidth || 400;
    const height = canvas.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);

    const hasData = dataValues.some(v => Math.abs(v) > 0.0001);
    if (!hasData){
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sin datos en este periodo', width/2, height/2);
      return;
    }

    const margin = { top: 18, right: 10, bottom: 40, left: 50 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const maxVal = Math.max(...dataValues, 0);
    const minVal = Math.min(...dataValues, 0);
    const useHorizontal = opts && opts.horizontal;

    if (!useHorizontal){
      const base = minVal < 0 ? minVal : 0;
      const scale = chartH / (maxVal - base || 1);
      const zeroY = margin.top + chartH - (0 - base) * scale;
      const n = dataValues.length;
      const barSpace = chartW / (n || 1);
      const barWidth = Math.max(12, barSpace * 0.6);

      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(margin.left, zeroY);
      ctx.lineTo(width - margin.right, zeroY);
      ctx.stroke();

      ctx.font = '10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';

      dataValues.forEach((val, i) => {
        const barHeight = (val - base) * scale;
        const x = margin.left + barSpace * i + (barSpace - barWidth)/2;
        const y = zeroY - barHeight;

        ctx.fillStyle = 'rgba(221,191,100,0.9)';
        if (val < 0){
          ctx.fillStyle = 'rgba(123,24,24,0.9)';
        }
        ctx.fillRect(x, Math.min(y, zeroY), barWidth, Math.abs(barHeight));

        const lbl = dataLabels[i];
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        const labelY = height - 10;
        ctx.save();
        ctx.translate(x + barWidth/2, labelY);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(lbl, 0, 0);
        ctx.restore();
      });
    } else {
      const base = minVal < 0 ? minVal : 0;
      const scale = chartW / (maxVal - base || 1);
      const n = dataValues.length;
      const barSpace = chartH / (n || 1);
      const barHeight = Math.max(10, barSpace * 0.6);

      ctx.font = '10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'right';

      dataValues.forEach((val, i) => {
        const barW = (val - base) * scale;
        const y = margin.top + barSpace * i + (barSpace - barHeight)/2;
        const x = margin.left;

        ctx.fillStyle = 'rgba(221,191,100,0.9)';
        if (val < 0){
          ctx.fillStyle = 'rgba(123,24,24,0.9)';
        }
        ctx.fillRect(x, y, Math.abs(barW), barHeight);

        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.textAlign = 'right';
        ctx.fillText(dataLabels[i], x - 4, y + barHeight*0.7);
      });
    }
  }

  function escapeHtml(str){
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

})();