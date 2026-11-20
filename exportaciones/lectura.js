/* Lecturas del centro: nunca crear ni actualizar esquemas o identidades. */
(function (g) {
  'use strict';
  const connections = new Map();
  function openExisting(name, stores = []) {
    if (connections.has(name)) return Promise.resolve(connections.get(name));
    return new Promise((resolve, reject) => {
      let finished = false;
      const request = indexedDB.open(name);
      const timer = setTimeout(() => fail('La lectura tardó demasiado. Cerrá otras pestañas y reintentá.'), 12000);
      function fail(message) {
        if (finished) return;
        finished = true; clearTimeout(timer); reject(new Error(message));
      }
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = () => fail(`No se pudo leer ${name}. Abrí antes el módulo correspondiente y volvé a Exportaciones.`);
      request.onblocked = () => fail('La base está bloqueada por otra pestaña. Cerrala y reintentá.');
      request.onsuccess = () => {
        const db = request.result;
        if (finished) { db.close(); return; }
        if (!stores.every(store => db.objectStoreNames.contains(store))) {
          db.close(); fail('Faltan datos necesarios. Abrí el módulo actualizado y volvé a Exportaciones.'); return;
        }
        finished = true; clearTimeout(timer); connections.set(name, db);
        db.onversionchange = () => { db.close(); connections.delete(name); };
        resolve(db);
      };
    });
  }
  async function readProducts() {
    const db = await openExisting('a33-pos', ['products']);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('products', 'readonly');
      const request = tx.objectStore('products').getAll();
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error || new Error('Lectura de productos interrumpida.'));
      tx.oncomplete = () => resolve((request.result || []).filter(row => !g.A33Products?.isDeletedProductId(g.A33Products.getProductId(row))));
    });
  }
  g.A33Exports = {openExisting, readProducts};
  // En estas pantallas getAll solo lee: los módulos operativos conservan su contrato original.
  if (g.A33Products) g.A33Products = Object.assign({}, g.A33Products, {getAll:readProducts});
})(window);
