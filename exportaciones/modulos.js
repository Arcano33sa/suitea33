/* E3: mismos generadores, fuera de los formularios operativos. */
(function () {
  'use strict';
  const node = id => document.getElementById(id);
  const module = document.body.dataset.a33Exports;
  let busy = false;
  async function refresh() {
    node('module-export-fields').disabled = true;
    node('module-export-retry').hidden = true;
    status('Cargando referencias…');
    try {
      if (module === 'analitica') await window.A33AnalyticsExports.refresh();
      if (module === 'catalogos') await window.A33CatalogExports.refresh();
      if (module === 'pedidos') await refreshPedidosProductCatalog(true);
      if (module === 'lotes') await refreshLoteProductCatalog(true);
      node('module-export-fields').disabled = false;
      if (module === 'analitica') node('btn-export-consolidado').disabled = false;
      sync(); status('Listo para exportar.');
    } catch (error) {
      status(error.message || 'No se pudieron cargar los datos.', true);
      node('module-export-retry').hidden = false;
    }
  }
  function status(message, error = false) {
    node('module-export-status').textContent = message;
    node('module-export-status').dataset.error = String(error);
  }
  function sync() {
    const report = node('module-export-report')?.value;
    for (const field of document.querySelectorAll('[data-report]')) field.hidden = field.dataset.report !== report;
    if (module === 'catalogos') node('module-export-form').querySelector('[type="submit"]').disabled = report === 'share'
      && !['includeName','includePhone','includeHistory'].some(name => node(name).checked);
  }
  async function download(event) {
    event.preventDefault();
    if (busy) return;
    const report = node('module-export-report')?.value;
    if (module === 'catalogos' && report === 'share' && !['includeName','includePhone','includeHistory'].some(name => node(name).checked)) {
      status('Elegí al menos un dato para compartir.', true); return;
    }
    busy = true; node('module-export-fields').disabled = true;
    status('Preparando reporte…');
    try {
      if (module === 'catalogos') {
        if (report === 'full') { await window.A33CatalogExports.refresh(); await window.A33CatalogExports.full(); }
        else {
          if (node('includeHistory').checked) await window.A33CatalogExports.refresh();
          await window.A33CatalogExports.share(Object.fromEntries(['includeName','includePhone','includeHistory'].map(name => [name,node(name).checked])));
        }
      }
      if (module === 'pedidos') {
        await refreshPedidosProductCatalog(true);
        if (report === 'orders') await exportToCSV();
        else {
          const demand = getPedidoDemandaPED();
          if (demand.error) throw new Error(demand.error);
          exportPedidoDemandaPED();
        }
      }
      if (module === 'lotes') { await refreshLoteProductCatalog(true); exportToCSV(); }
      status('Solicitud finalizada. Revisá la descarga o el aviso del reporte.');
    } catch (error) { status(error.message || 'No se pudo exportar el reporte.', true); }
    finally { busy = false; node('module-export-fields').disabled = false; }
  }
  node('module-export-form')?.addEventListener('submit', download);
  node('module-export-fields').addEventListener('change', sync);
  node('module-export-refresh').addEventListener('click', refresh);
  node('module-export-retry').addEventListener('click', refresh);
  refresh();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=4.20.98&r=3').catch(() => {});
})();
