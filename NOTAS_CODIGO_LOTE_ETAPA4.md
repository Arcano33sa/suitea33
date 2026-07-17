# Suite A33 — Código de lote — Etapa 4/6

## Alcance aplicado

- Reempaque permite seleccionar el lote origen disponible por evento y producto.
- La baja del origen y el alta del destino conservan ID interno, grupo de carga y código oficial completo.
- POS asigna y congela las cantidades consumidas por lote al registrar ventas, cortesías y devoluciones.
- El costo unitario prioriza el lote exacto y conserva compatibilidad con FIFO, reempaque, catálogo e históricos.
- Ventas e históricos muestran el código de lote trazado sin interpretar el consecutivo comprimido como número.
- Los códigos nuevos mantienen la `x` minúscula; códigos históricos desconocidos no se renombran ni recalculan.

## Smoke técnico automatizado

- Sintaxis de `pos/app.js`, `pos/sw.js` y `assets/js/a33-lot-code.js`: aprobada.
- Reconocimiento de `A33KIS5786-0xx1`, variante AV y compatibilidad histórica: aprobado.
- Distribución de una venta entre lotes y cálculo ponderado de costo exacto: aprobado.
- Reempaque con baja de origen, alta de destino, costo distribuido y trazabilidad: aprobado.
- Cortesía con inventario, costo real y venta neta cero: aprobado.
- Verificación de funciones duplicadas, conversión numérica indebida y limpieza de datos: aprobada.

No se agregaron dependencias ni se modificaron exportaciones generales, Firebase, cierres o datos históricos.
