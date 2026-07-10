# Suite A33 — Lotes Lectura Dinámica — Parte 3/4 Etapa 1/4

Fecha y hora de entrega: 21/06/2026 20:37

## Cambios aplicados

- Lotes puede leer productos activos con Receta y Letra desde Catálogos (`a33-pos/products`).
- Se conserva compatibilidad con presentaciones legacy P/M/D/L/G.
- Se preparan datos dinámicos para Lotes: productId, nombre, Letra, Receta, activo, envaseId, tapaId, capacidad ml y costo cuando existan.
- Se agrega barra compacta de productos producibles y totales dinámicos por Letra.
- Se muestran chips dinámicos en filas, tarjetas, detalle, histórico y exportación Excel.
- Se actualiza caché PWA de Lotes para reflejar `index.html`, `style.css`, `script.js` y `manifest` nuevos.

## Validaciones realizadas

- `node --check lotes/script.js` OK.
- `node --check lotes/sw.js` OK.
- `node --check catalogos/script.js` OK.
- `node --check catalogos/sw.js` OK.

## Alcance preservado

- No se tocó POS.
- No se tocó Finanzas.
- No se tocaron ventas, cierres, Caja Chica, Recibos ni reportes.
- No se borran lotes, productos, envases, tapas, localStorage ni IndexedDB.
- No se recalculan códigos de lotes existentes.
