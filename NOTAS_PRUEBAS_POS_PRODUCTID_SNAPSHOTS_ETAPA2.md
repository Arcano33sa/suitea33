# Suite A33 POS — Parte 4/4 — Etapa 2/6

Fecha y hora de entrega: 21/06/2026 21:11

## Cambios aplicados

- Se agregó blindaje de venta POS por `productId` estable.
- Se agregaron snapshots históricos explícitos al guardar ventas normales:
  - `productNameSnapshot`
  - `unitPriceSnapshot`
  - `productSnapshot` con datos básicos del catálogo al momento de vender.
- Se mantuvo compatibilidad con ventas antiguas que solo tienen `productName` / `unitPrice`.
- Se evitó guardar ventas con producto inexistente, inactivo o sin marca POS cuando el selector quedó desactualizado.
- Se reforzó la lectura defensiva de nombre/precio en historial y exportaciones Excel del POS.
- Se agregaron snapshots equivalentes para Extras sin convertirlos en productos normales.
- Se actualizó el query de `pos/app.js` en POS y el precache del service worker del módulo POS para reflejar el archivo nuevo.

## Pruebas realizadas

- `node --check pos/app.js`
- `node --check pos/sw.js`
- Revisión estática de flujo principal de venta normal.
- Revisión estática de venta de Extras.
- Revisión estática de historial/exportación POS para usar snapshot cuando exista y fallback legacy cuando no exista.

## Límites respetados

- No se tocaron Calculadora de Producción, Calculadora Temporal, Lotes, Finanzas, Caja Chica, Recibos ni cierres.
- No se recalcularon ventas antiguas.
- No se migraron agresivamente históricos.
- No se borró localStorage, IndexedDB ni datos de negocio.
- No se agregaron dependencias nuevas.
