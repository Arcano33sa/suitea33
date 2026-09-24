/* Descarga inicial de Catálogos. No escribe en Firebase. */
(function(g){
  'use strict';
  const specs = [
    ['productos','products'], ['materia_prima','rawMaterials'],
    ['extras','extras'], ['bancos','banks'],
    ['envases',null,'a33_catalog_envases_v1'],
    ['tapas',null,'a33_catalog_tapas_v1'],
    ['clientes',null,'a33_pos_customersCatalog']
  ].map(([entity,store,key]) => ({entity,store,key,kind:store || ({envases:'envases',tapas:'tapas',clientes:'customers'}[entity])}));
  function records(documents){
    const rows = [];
    const ids = new Set();
    for (const doc of documents){
      // E5 puede incluir metadatos de localStorage: no son registros del catálogo.
      if (/__meta:/.test(String(doc.sourceId || ''))) continue;
      if (/^a33_pos_customer(?:Sticky|Last|ManageFilter|ManageCompact|ManageOpenGroups):/i.test(String(doc.sourceId || ''))) continue;
      const row = doc.payload;
      if (doc.deleted === true || (row && row.deleted === true)) continue;
      if (!row || Array.isArray(row) || typeof row !== 'object'
        || !((typeof row.id === 'string' && row.id.trim()) || (typeof row.id === 'number' && Number.isFinite(row.id)))) throw new Error('Registro remoto sin identificador válido.');
      const id = String(row.id);
      if (ids.has(id)) throw new Error('Identificador remoto duplicado.');
      ids.add(id);
      rows.push(JSON.parse(JSON.stringify(row)));
    }
    return rows;
  }
  async function download(io){
    if (!io.authorized()) throw new Error('La sesión no permite descargar Catálogos.');
    const pending = [], skipped = [];
    for (const spec of specs){
      if (await io.hasLocal(spec)) skipped.push(spec.entity);
      else pending.push(spec);
    }
    // Validar todas las lecturas antes de incorporar ningún registro.
    const batches = await Promise.all(pending.map(async spec => ({spec, rows:records(await io.read(spec))})));
    let added = 0;
    for (const {spec,rows} of batches){
      if (!io.authorized()) throw new Error('La sesión cambió durante la descarga.');
      if (await io.hasLocal(spec)){ skipped.push(spec.entity); continue; }
      added += await io.insertIfEmpty(spec,rows);
    }
    return {added,skipped};
  }
  function canDownloadCustomers(raw){
    try{
      return raw.every((value, index) => {
        if (value === null) return true;
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.length === 0;
        return index === 1 && parsed && typeof parsed === 'object' && Object.keys(parsed).length === 0;
      });
    }catch(_){ return false; }
  }
  async function downloadCustomers(io){
    const check = () => {
      if (!io.authorized()) throw new Error('La sesión cambió o no permite descargar Clientes.');
      if (!canDownloadCustomers(io.localState())) throw new Error('Se conservan los clientes, inactivos o eliminaciones locales. No se descargó ningún cliente.');
    };
    check();
    const rows = records(await io.read());
    check();
    // Guardado síncrono inmediatamente después de volver a validar el estado local.
    if (rows.length) io.save(rows);
    return rows.length;
  }
  g.A33CatalogDownload = Object.freeze({download,records,specs,canDownloadCustomers,downloadCustomers});
})(typeof globalThis !== 'undefined' ? globalThis : window);
