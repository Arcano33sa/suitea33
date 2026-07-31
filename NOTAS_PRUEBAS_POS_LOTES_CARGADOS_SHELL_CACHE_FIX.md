# Suite A33 — POS — Lotes cargados — reparación shell/caché

- Release visible: 4.20.97 r5.
- Caché POS: m47.
- Se alinearon `a33-release.js`, `a33-build.js`, `pos/index.html`, `pos/sw.js`, manifest y registro del Service Worker.
- Navegación POS usa red sin caché HTTP y conserva fallback offline al shell canónico.
- `app.js` reconstruye únicamente el bloque visual de Lotes cargados cuando un HTML anterior se mezcla con JS nuevo.
- No se borran ni migran IndexedDB, localStorage, Firebase, JSON ni movimientos históricos.
