# Suite A33 — Lotes respeta productos borrados en Catálogos

Fecha y hora de entrega: 22/06/2026 13:00

## Cambio aplicado

- Lotes ahora lee `a33_catalog_deleted_products_v1` para respetar productos maestros borrados desde Catálogos.
- La compatibilidad legacy P/M/D/L/G se mantiene para lectura histórica, pero no vuelve a mostrar como producible un producto borrado.
- Si Galón 3750 ml fue borrado, la letra G ya no se ofrece para crear nuevos lotes.
- Los lotes históricos que ya tengan G conservan su snapshot/cantidad cuando se visualizan o editan.
- Se ajustó el listado, tarjetas y barra de totales para ocultar letras legacy borradas cuando no existen cantidades históricas visibles.
- Se actualizó el cache-busting de Lotes (`script.js` r12) y el precache del service worker del módulo.

## Pruebas realizadas

- `node --check lotes/script.js`
- `node --check lotes/sw.js`
- Revisión estática de referencias a marcas de borrado de productos.
- Revisión de cache/versionado en `lotes/index.html` y `lotes/sw.js`.

## Alcance protegido

- No se tocó POS.
- No se tocó Inventario.
- No se tocaron ventas históricas.
- No se borraron lotes, producción, cálculos ni datos locales.
- No se agregó ninguna dependencia nueva.
