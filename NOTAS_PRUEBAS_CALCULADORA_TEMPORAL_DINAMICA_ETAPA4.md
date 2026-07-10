# Suite A33 — Calculadora Temporal Dinámica — Etapa 4

Fecha y hora de entrega: 21/06/2026 20:19

## Cambios aplicados

- Calculadora Temporal ahora toma la lista viva de productos activos con Receta desde Catálogos/Producción.
- Se excluye Vaso de la lista temporal.
- Se copia configuración útil del producto dinámico: productId, nombre, Letra, envaseId, tapaId, capacidad y costo referencial si existe.
- Se agregó lectura de catálogo de tapas/corchos para mostrar Envase / tapa como referencia en el plan temporal.
- Se mantiene aislamiento total: los guardados escriben solo en claves temporales propias y no en inventario, lotes, POS ni Finanzas.
- La caché de fecha hebrea de Temporal queda separada de la Calculadora real.
- Las recetas oficiales de Producción se usan solo como semilla de lectura para Temporal; los cambios guardados en Temporal permanecen en almacenamiento temporal separado.

## Verificación estática

- HTML/JS de Calculadora Temporal validado con extracción de scripts y `node --check`.
- Se revisó que Calculadora Temporal no escriba en `arcano33_inventario`, `arcano33_lotes`, POS ni Finanzas.
- Se mantiene la lógica de historial y consecutivo temporal propio.
