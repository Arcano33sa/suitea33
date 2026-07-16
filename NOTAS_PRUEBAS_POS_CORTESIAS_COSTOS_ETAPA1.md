# Suite A33 — POS — Costo de Cortesías — Etapa 1/2

## Reparación aplicada

- Se centralizó la resolución de identidad de producto para reconocer `productId` estable, ID interno numérico, objeto de producto, letra y compatibilidad histórica por nombre únicamente como último recurso.
- Lotes/Producción y Reempaque dejaron de convertir directamente el `productId` estable mediante `Number(productId)`.
- Los resolutores de costo comparan tanto el identificador estable como el ID interno requerido por inventario y movimientos legacy.
- Reempaque conserva la lectura principal desde movimientos de inventario y añade fallback compatible al snapshot del registro de Reempaque.
- La prioridad queda: snapshot existente, Lote/Producción/FIFO, Reempaque, costo de Catálogo y calculadora legacy.
- No se recalcularon ni modificaron operaciones históricas.
- No se cambiaron colecciones Firebase, JSON, precios, descuentos, cierres, clientes, eventos ni métodos de pago.

## Smoke técnico ejecutado

- Costo directo desde Catálogo: OK.
- Costo desde Lote con ID interno y venta con `productId` estable: OK.
- Costo desde Producción/Lote con `productId` estable: OK.
- Costo desde Reempaque por movimiento de inventario: OK.
- Fallback de costo desde snapshot de Reempaque: OK.
- Prioridad de snapshot de operación existente: OK.
- Cortesía con ingreso cero y costo real congelado: OK.
- `productId` estable e ID interno resuelven el mismo producto: OK.
- Producto sin fuente de costo queda en cero con `sin_costo_confiable`: OK.
