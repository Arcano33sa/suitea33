/* Centro de Exportaciones, E1: adapta referencias; el POS conserva los generadores. */
(function () {
  'use strict';
  const node = id => document.getElementById(id);
  const descriptions = {
    events: 'Lista completa de eventos, igual que la exportación original del POS.',
    closure: 'Archivo integral del evento. Conserva las reglas de caja cerrada, identidad y vista previa.',
    pdf: 'Abre la impresión del cierre. Elegí Guardar como PDF; requiere PDF habilitado en Configuración → Reportes.',
    sales: 'Detalle de ventas del evento. Corresponde al botón anteriormente llamado CSV Ventas; el archivo es Excel.',
    inventory: 'Inventario del evento con las preferencias actuales de reportes.',
    group: 'Consolidado del grupo, con sus eventos y presentaciones.',
    summary: 'Resumen del período y evento seleccionados, con los mismos cálculos del POS.',
    archive: 'Reexporta las hojas guardadas en el archivo histórico, sin recalcularlas.',
    manager: 'Consolidado de gerente: archivo histórico más período seleccionado, según las reglas actuales del POS.',
    'cash-event': 'Todas las versiones guardadas de los cierres de caja del evento.',
    'cash-day': 'Snapshot del día y la versión seleccionados.'
  };
  let events = [];
  let archives = [];
  let generation = 0;
  let busy = false;

  function status(message, error = false) {
    node('exports-status').textContent = message;
    node('exports-status').dataset.error = String(error);
  }
  function options(select, rows, placeholder) {
    const previous = select.value;
    select.replaceChildren(new Option(placeholder, ''), ...rows.map(([value, label]) => new Option(label, String(value))));
    if (rows.some(([value]) => String(value) === previous)) select.value = previous;
  }

  // Abrir una base existente, sin crear esquema ni ejecutar el inicio operativo del POS.
  function connect() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error('No se pudo abrir el POS a tiempo. Cerrá otras pestañas y reintentá.')); }, 12000);
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = () => { clearTimeout(timer); reject(new Error('No hay una base POS disponible. Abrí el POS una vez y volvé a Exportaciones.')); };
      request.onblocked = () => { clearTimeout(timer); reject(new Error('La base POS está bloqueada por otra pestaña. Cerrala y reintentá.')); };
      request.onsuccess = () => {
        clearTimeout(timer);
        const connection = request.result;
        if (expired) { connection.close(); return; }
        if (connection.version !== DB_VER) {
          connection.close();
          reject(new Error('La base POS necesita una versión compatible. Abrí el POS actualizado y volvé a Exportaciones.'));
          return;
        }
        db = connection;
        db.onversionchange = () => {
          db.close(); db = null;
          node('exports-fields').disabled = true;
          node('export-retry').hidden = false;
          status('El POS cambió de versión. Recargá Exportaciones para continuar.', true);
        };
        resolve(db);
      };
    });
  }

  async function references() {
    node('exports-fields').disabled = true;
    node('export-retry').hidden = true;
    status('Cargando referencias del POS…');
    try {
      await connect();
      const rows = await Promise.all([getAll('events'), getAll('summaryArchives')]);
      events = rows[0]; archives = rows[1];
      const eventOptions = events.map(event => [event.id, `${event.name || 'Evento'}${event.closedAt ? ' · cerrado' : ''} · #${event.id}`]);
      options(node('export-event'), eventOptions, 'Seleccioná un evento');
      options(node('export-summary-event'), [['global', 'Todos los eventos'], ...eventOptions], 'Seleccioná una referencia');
      if (!node('export-summary-event').value) node('export-summary-event').value = 'global';
      const groups = [...new Set(events.map(event => String(event.groupName || '').trim()))].sort((a, b) => a.localeCompare(b, 'es'));
      options(node('filtro-grupo'), groups.map(group => [group || '__sin_grupo__', group || '[Sin grupo]']), 'Seleccioná un grupo');
      options(node('export-archive'), archives.slice().sort((a, b) => String(b.periodKey || '').localeCompare(String(a.periodKey || '')))
        .map(archive => [archive.id, `${archive.seqStr || archive.seq || ''} · ${archive.periodLabel || archive.periodKey || archive.id}`]), 'Seleccioná un período archivado');
      if (!node('summary-period').value) node('summary-period').value = periodKeyFromDatePOS(new Date());
      node('exports-fields').disabled = false;
      await sync();
      status(events.length ? 'Referencias listas.' : 'No hay eventos disponibles en el POS. Podés reexportar períodos si hay archivos guardados.');
    } catch (error) {
      status(error.message || 'No se pudieron cargar las referencias.', true);
      node('export-retry').hidden = false;
    }
  }

  function validate() {
    const report = node('export-report').value;
    if (['closure', 'pdf', 'sales', 'inventory', 'cash-event', 'cash-day'].includes(report) && !node('export-event').value) return 'Seleccioná un evento.';
    if (report === 'group' && !node('filtro-grupo').value) return 'Seleccioná un grupo.';
    if (['summary', 'manager'].includes(report) && !/^\d{4}-(0[1-9]|1[0-2])$/.test(node('summary-period').value)) return 'Seleccioná un período válido.';
    if (report === 'summary' && !node('export-summary-event').value) return 'Seleccioná el evento del resumen o Todos los eventos.';
    if (report === 'archive' && !node('export-archive').value) return 'No hay un período archivado seleccionado.';
    if (report === 'cash-day' && (!node('export-day').value || !node('export-version').value)) return 'Seleccioná un día con cierre y una versión guardada.';
    return '';
  }

  async function sync() {
    const token = ++generation;
    const report = node('export-report').value;
    node('export-description').textContent = descriptions[report];
    const fields = {
      event: ['closure', 'pdf', 'sales', 'inventory', 'cash-event', 'cash-day'].includes(report),
      'summary-event': report === 'summary', group: report === 'group', period: ['summary', 'manager'].includes(report),
      archive: report === 'archive', day: report === 'cash-day', version: report === 'cash-day'
    };
    for (const [field, visible] of Object.entries(fields)) node(`export-${field}-field`).hidden = !visible;
    node('export-download').textContent = report === 'pdf' ? 'Abrir impresión / PDF' : 'Descargar Excel';
    node('export-download').disabled = true;
    try {
      if (report === 'cash-day') {
        const eventId = node('export-event').value;
        const days = eventId ? await listHistDaysForEvent(eventId) : [];
        if (token !== generation) return;
        options(node('export-day'), days.map(day => [day.dayKey, day.dayKey]), 'Seleccioná un día');
        const dayKey = node('export-day').value;
        const versions = dayKey ? await listSnapshots(eventId, dayKey) : [];
        if (token !== generation) return;
        options(node('export-version'), versions.map(version => [version, `Versión ${version}`]), 'Seleccioná una versión');
      }
      node('export-download').disabled = busy;
      status(validate() || 'Listo para exportar.');
    } catch (error) {
      if (token === generation) status('No se pudo leer el histórico. ' + error.message, true);
    }
  }

  async function download(event) {
    event.preventDefault();
    if (busy) return;
    const invalid = validate();
    if (invalid) { status(invalid, true); return; }
    busy = true;
    node('exports-fields').disabled = true;
    status('Preparando reporte…');
    try {
      const eventId = Number(node('export-event').value);
      const periodKey = node('summary-period').value;
      switch (node('export-report').value) {
        case 'events': await exportEventosExcel(); break;
        case 'closure': await exportEventClosureWorkbookPOS(eventId); break;
        case 'pdf': await exportEventClosurePdfPOS(eventId); break;
        case 'sales': await exportEventSalesCSV(eventId); break;
        case 'inventory': await exportEventInventoryExcelPOS(eventId); break;
        case 'group': await exportCierreTotalGrupoExcel(); break;
        case 'summary': {
          const data = await computeSummaryDataForPeriodPOS(periodKey, node('export-summary-event').value);
          writeWorkbookFromSheetsPOS(`Resumen-${periodFilePartPOS(periodKey)}.xlsx`, buildSummarySheetsFromDataPOS(data));
          break;
        }
        case 'archive': {
          const selected = archives.find(record => String(record.id) === node('export-archive').value);
          const archive = selected ? await getOne('summaryArchives', selected.id) : null;
          if (!archive || !Array.isArray(archive.snapshot?.sheets) || !archive.snapshot.sheets.length) throw new Error('El archivo seleccionado ya no está disponible o no contiene hojas guardadas.');
          writeWorkbookFromSheetsPOS(archive.fileName || `${archive.seqStr || pad3POS(archive.seq || 0)}-${periodFilePartPOS(archive.periodKey || '')}.xlsx`, archive.snapshot.sheets);
          break;
        }
        case 'manager': await exportConsolidatedGerenteExcelPOS(); break;
        case 'cash-event': await cashV2ExportHistExcelEvent(eventId); break;
        case 'cash-day':
          __CASHV2_HIST_DETAIL_STATE = {eventId: String(eventId), dayKey: node('export-day').value, v: Number(node('export-version').value)};
          await cashV2ExportHistExcelDay(); break;
        default: throw new Error('Reporte no disponible.');
      }
      // Algunos generadores cancelan o informan datos faltantes mediante el aviso original del POS.
      status('Solicitud finalizada. Revisá la descarga o el aviso del reporte.');
    } catch (error) {
      status(error.message || 'No se pudo exportar el reporte.', true);
    } finally {
      busy = false;
      node('exports-fields').disabled = !db;
    }
  }

  node('exports-form').addEventListener('submit', download);
  for (const id of ['export-report', 'export-event', 'export-summary-event', 'filtro-grupo', 'summary-period', 'export-archive', 'export-day', 'export-version']) node(id).addEventListener('change', sync);
  node('export-refresh').addEventListener('click', references);
  node('export-retry').addEventListener('click', references);
  references();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=4.20.98&r=3').catch(() => {});
})();
