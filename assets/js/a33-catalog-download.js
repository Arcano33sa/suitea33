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
  g.A33CatalogDownload = Object.freeze({download,records,specs});
})(typeof globalThis !== 'undefined' ? globalThis : window);
