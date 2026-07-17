# Suite A33 — Código de lote — Etapa 3/6

## Alcance aplicado

- Integración del código nuevo e histórico en Lotes, listados, búsqueda, filtros, selección y exportación.
- Conservación canónica de las `x` minúsculas en códigos nuevos.
- Identidad estable por `loteId`/`id`/`operationId`, con compatibilidad por código como respaldo.
- Orden cronológico con desempate por consecutivo numérico.
- Checklist independiente por lote, selección automática del lote recién guardado y recuperación de volúmenes.
- Trazabilidad del producto terminado en Inventario con lote, presentación, cantidad, fecha, costo, existencia y operación.
- Idempotencia conservada para impedir lotes, movimientos y existencias duplicadas.

## Pruebas ejecutadas

- Sintaxis JavaScript en módulos afectados y scripts inline.
- Generación y validación de `A33KIS5786-0xx1` y `A33AV5786-0xx1`.
- Reconocimiento de código histórico.
- Búsqueda por código completo, identidad y fragmentos con `x` mediante los índices implementados.
- Orden por fecha y consecutivo.
- Persistencia independiente de dos checklists y conservación de checklist histórico.
- Recuperación de volúmenes del lote seleccionado.
- Entrada de producto terminado con código, lote, envase, tapa y costos.
- Doble commit de la misma operación sin duplicar lote, movimientos ni existencia.

## Resultado

Smoke test automatizado: **OK**.
