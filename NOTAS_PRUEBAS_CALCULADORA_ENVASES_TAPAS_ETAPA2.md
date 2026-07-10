# Suite A33 — Calculadora Producción — Parte 2/4 Etapa 2/5

Fecha y hora de entrega: 21/06/2026 20:08

## Cambios aplicados

- La Calculadora de Producción ya permite guardar producción de productos con Receta usando `envaseId` y `tapaId` tomados desde Catálogos → Productos.
- Al guardar producción real, descuenta dinámicamente el envase asociado y la tapa/corcho asociada según la cantidad producida.
- Se mantiene compatibilidad con Pulso, Media, Djeba, Litro y Galón: si usan `envaseId`/`tapaId`, se mapean al inventario legacy actual; si no, se conserva fallback legacy seguro.
- Catrina no recibe excepción de “tapa incluida”: si tiene Botella Catrina y Corcho Catrina asignados, ambos se descuentan.
- Productos con Receta sin envase/tapa asignados quedan bloqueados con advertencia clara antes de guardar, para evitar descuentos falsos.
- La tabla de Plan de Producción muestra de forma compacta el envase/tapa asociado sin rediseñar la Calculadora.
- La suma de producto terminado dinámico queda reservada para etapa posterior; en esta etapa solo se conserva suma de producto terminado para presentaciones legacy.

## Pruebas realizadas

- `node --check` del script inline de `calculadora/index.html`: OK.
- `node --check` de `catalogos/script.js`: OK.
- `node --check` de `inventario/script.js`: OK.
- `node --check` de `lotes/script.js`: OK.
- `node --check` de `pos/app.js`: OK.
- `node --check` de `finanzas/script.js`: OK.
- Verificación grep: eliminado el bloqueo anterior que impedía guardar productos dinámicos no legacy.
- Verificación grep: presentes `envaseId`, `tapaId`, validación de empaque y consumo dinámico desde Calculadora.
