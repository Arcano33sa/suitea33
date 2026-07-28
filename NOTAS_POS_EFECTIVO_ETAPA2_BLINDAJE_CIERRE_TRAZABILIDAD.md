# Suite A33 — POS — Efectivo — Etapa 2/3

Fecha y hora de entrega: 27/07/2026 18:54

## Cambios aplicados

- Cobros atómicos y trazables entre venta al crédito y caja del día real.
- Abonos parciales y pagos totales con estado derivado Pendiente, Abonada o Pagada.
- Bloqueo de sobrepagos, doble toque, listeners duplicados, solicitudes repetidas y ventas anuladas/revertidas.
- Entrada y Salida registradas de forma atómica; Entrada no afecta utilidad y Salida sí se clasifica como gasto operativo.
- Cuadre blindado: Apertura + Ventas de contado + Entradas + Cobros - Salidas.
- Exclusión de movimientos revertidos y cobros duplicados por identidad al calcular caja e historial.
- Protección contra eliminación de ventas con cobros vinculados.
- Trazabilidad visible de cliente, referencia, saldo anterior y saldo posterior.
- Revisiones de caché PWA incrementadas sin modificar el sistema central de actualización.

## Validación

- Smoke específico Etapa 2: PASS — 25/25 controles.
- Sintaxis JavaScript: PASS en pos/app.js y pos/sw.js.
- Manifest PWA: JSON válido.
- Comparación contra la base: solo cambiaron POS y pruebas específicas; package.json y dependencias permanecen intactos.
- Suite histórica: los 13 fallos de pruebas antiguas ya estaban presentes en la base recibida; esta etapa añadió una prueba nueva aprobada y no incrementó fallos heredados.
