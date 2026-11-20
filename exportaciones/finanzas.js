/* E2: referencias de Finanzas; los generadores y cálculos siguen en su módulo. */
(function () {
  'use strict';
  const node = id => document.getElementById(id);
  const reports = {
    diary: {label:'Diario · Excel', group:'diary', run:exportDiarioExcel, description:'Diario con los filtros originales de tipo, evento, origen, proveedor y fechas.'},
    current: {label:'Compras por hacer · Excel', run:pcExportCurrentExcel, description:'La planificación de compras actual, sin modificarla ni generar asientos.'},
    history: {label:'Compras históricas · Excel', group:'history', description:'El registro guardado seleccionado, con sus productos, notas y totales.'},
    catalog: {label:'Catálogo de cuentas · Excel', run:catExportCatalogExcel, description:'Las hojas de cuentas y resumen del catálogo actual.'},
    er: {label:'Estado de Resultados · Excel', group:'period', run:exportEstadoResultadosExcel, description:'Estado de Resultados con el período y evento habituales.'},
    share: {label:'Estado de Resultados para compartir · Excel', group:'period', run:() => exportEstadoResultadosExcel({share:true}), description:'Resumen que aplica la identidad y privacidad de Configuración → Reportes.'},
    balance: {label:'Balance General · Excel', group:'balance', run:exportBalanceGeneralExcel, description:'Balance General a la fecha de corte seleccionada.'},
    flow: {label:'Flujo de Caja · Excel', group:'period', run:exportFlujoCajaExcel, description:'Flujo de Caja con el mismo período usado por el Estado de Resultados; el generador original no filtra por evento.'},
    mayor: {label:'Mayor por cuenta · Excel', group:'mayor', run:exportMayorReportExcel, description:'Movimientos y saldos de la cuenta contable, con fechas y búsqueda existentes.'},
    account: {label:'Estado de cuenta financiera · Excel', group:'account', run:exportEstadoCuentaReportExcel, description:'Estado de la caja o banco seleccionado; conserva moneda original y equivalentes contables.'},
    balanza: {label:'Balanza de comprobación · Excel', group:'balanza', run:exportBalanzaReportExcel, description:'Totales DEBE y HABER por cuenta, con fechas y búsqueda existentes.'},
    book: {label:'Libro Diario · Excel', group:'book', run:exportLibroReportExcel, description:'Detalle por asiento con fechas, origen y búsqueda existentes.'},
    currency: {label:'Resumen por moneda · Excel', group:'currency', run:exportResumenMonedaReportExcel, description:'Resumen por moneda original y equivalentes, usando el T/C guardado en los movimientos.'},
    receipt: {label:'Recibo · PDF', group:'receipt', description:'Solo recibos emitidos o anulados. Abre la impresión original de dos copias en una página.'}
  };
  let busy = false;
  let history = [];
  let receipts = [];
  let historyReferences = new Map();
  // El normalizador original asigna IDs temporales a históricos antiguos sin identificador.
  const historyContent = record => JSON.stringify(record, (key, value) => key === 'id' ? undefined : value);

  function status(message, error = false) {
    node('finance-exports-status').textContent = message;
    node('finance-exports-status').dataset.error = String(error);
  }
  function options(select, rows, placeholder) {
    const previous = select.value;
    select.replaceChildren(new Option(placeholder, ''), ...rows.map(([value, label]) => new Option(label, String(value))));
    if (rows.some(([value]) => String(value) === previous)) select.value = previous;
  }
  function connect() {
    if (finDB) return Promise.resolve(finDB);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(FIN_DB_NAME);
      let finished = false;
      const timer = setTimeout(() => fail('Finanzas tardó demasiado en responder. Cerrá otras pestañas y reintentá.'), 12000);
      function fail(message) {
        if (finished) return;
        finished = true; clearTimeout(timer); reject(new Error(message));
      }
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = () => fail('No hay una base de Finanzas disponible. Abrí Finanzas una vez y volvé a Exportaciones.');
      request.onblocked = () => fail('La base de Finanzas está bloqueada. Cerrá otras pestañas y reintentá.');
      request.onsuccess = () => {
        const connection = request.result;
        if (finished) { connection.close(); return; }
        if (connection.version < FIN_DB_VERSION || !['accounts','journalEntries','journalLines','settings','receipts'].every(name => connection.objectStoreNames.contains(name))) {
          connection.close(); fail('La base necesita una versión compatible. Abrí Finanzas actualizado y volvé a Exportaciones.'); return;
        }
        finished = true; clearTimeout(timer);
        finDB = connection;
        finDB.onversionchange = () => {
          connection.close(); finDB = null; finCachedData = null;
          node('finance-exports-fields').disabled = true;
          node('finance-export-retry').hidden = false;
          status('Finanzas cambió de versión. Recargá Exportaciones para continuar.', true);
        };
        resolve(finDB);
      };
    });
  }

  async function readData() {
    await connect();
    // getAllFinData solo lee; refreshAllFin también sincroniza cobros y pinta pantallas operativas.
    finCachedData = await getAllFinData();
    await refreshPosEventsCache(finCachedData.posEvents);
    await pcLoadAll();
    history = pcHistory?.history || [];
    receipts = (finCachedData.receipts || []).filter(row => ['ISSUED','VOID'].includes(row.status) && rcNumber4(row.number));
  }
  async function refresh() {
    node('finance-exports-fields').disabled = true;
    node('finance-export-retry').hidden = true;
    status('Cargando referencias de Finanzas…');
    try {
      await readData();
      updateEventFilters(finCachedData);
      updateSupplierSelects(finCachedData);
      finReportsFillSelectors(finCachedData);
      historyReferences = new Map(history.map(record => [String(record.id), historyContent(record)]));
      options(node('finance-export-history'), history.map(record => [record.id, `${record.createdAtDisplay || record.createdAtISO || 'Sin fecha'} · ${record.notes || record.id}`]), 'Seleccioná una compra histórica');
      options(node('finance-export-receipt'), receipts.slice().sort((a,b) => String(b.dateISO || '').localeCompare(String(a.dateISO || '')))
        .map(receipt => [receipt.receiptId, `N.º ${rcNumber4(receipt.number)} · ${receipt.clientName || 'Sin cliente'} · ${receipt.dateDisplay || receipt.dateISO || ''} · ${receipt.status === 'VOID' ? 'anulado' : 'emitido'}`]), 'Seleccioná un recibo');
      node('finance-exports-fields').disabled = false;
      sync();
    } catch (error) {
      status(error.message || 'No se pudieron cargar las referencias.', true);
      node('finance-export-retry').hidden = false;
    }
  }
  function validate() {
    const report = node('finance-export-report').value;
    if (report === 'history' && !node('finance-export-history').value) return 'Seleccioná una compra histórica.';
    if (report === 'receipt' && !node('finance-export-receipt').value) return 'Seleccioná un recibo emitido o anulado.';
    if (report === 'mayor' && !node('rep-mayor-cuenta').value) return 'No hay una cuenta contable seleccionada.';
    if (report === 'account' && !node('rep-estado-fa').value) return 'No hay una cuenta financiera seleccionada.';
    return '';
  }
  function sync() {
    const key = node('finance-export-report').value;
    const report = reports[key];
    document.querySelectorAll('[data-fin-group]').forEach(group => { group.hidden = group.dataset.finGroup !== report.group; });
    const month = node('er-modo').value === 'mes';
    for (const id of ['er-mes','er-anio']) document.querySelector(`[data-fin-field="${id}"]`).hidden = !month;
    for (const id of ['er-desde','er-hasta']) document.querySelector(`[data-fin-field="${id}"]`).hidden = month;
    document.querySelector('[data-fin-field="er-evento"]').hidden = key === 'flow';
    node('finance-export-description').textContent = report.description;
    node('finance-export-download').textContent = key === 'receipt' ? 'Abrir impresión / PDF' : 'Descargar Excel';
    status(validate() || 'Listo para exportar.');
  }
  async function download(event) {
    event.preventDefault();
    if (busy) return;
    const invalid = validate();
    if (invalid) { status(invalid, true); return; }
    busy = true;
    node('finance-exports-fields').disabled = true;
    status('Preparando reporte…');
    try {
      await readData();
      const key = node('finance-export-report').value;
      if (key === 'history') {
        const selectedId = node('finance-export-history').value;
        const record = history.find(row => String(row.id) === selectedId)
          || history.find(row => historyContent(row) === historyReferences.get(selectedId));
        if (!record) throw new Error('La compra histórica ya no está disponible. Actualizá las referencias.');
        pcExportRecordExcel(record);
      } else if (key === 'receipt') {
        const selected = receipts.find(row => String(row.receiptId) === node('finance-export-receipt').value);
        if (!selected) throw new Error('El recibo ya no está disponible para imprimir. Actualizá las referencias.');
        rcPrintReceipt(selected);
      } else {
        await reports[key].run();
      }
      status('Solicitud finalizada. Revisá la descarga, impresión o el aviso del reporte.');
    } catch (error) {
      status(error.message || 'No se pudo exportar el reporte.', true);
    } finally {
      busy = false;
      node('finance-exports-fields').disabled = !finDB;
    }
  }

  node('finance-export-report').replaceChildren(...Object.entries(reports).map(([key, report]) => new Option(report.label, key)));
  fillMonthYearSelects();
  node('finance-exports-form').addEventListener('submit', download);
  node('finance-exports-fields').addEventListener('change', sync);
  node('finance-export-refresh').addEventListener('click', refresh);
  node('finance-export-retry').addEventListener('click', refresh);
  refresh();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=4.20.98&r=3').catch(() => {});
})();
