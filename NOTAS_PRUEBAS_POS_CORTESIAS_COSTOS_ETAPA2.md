# Suite A33 — Costo de cortesías — Etapa 2/2

## Integración aplicada

- Lector defensivo centralizado en `assets/js/a33-sale-cost.js`.
- Prioridad de lectura: costo total de línea válido, costo total legacy válido, costo unitario snapshot por cantidad y cero solo ante ausencia real.
- POS, cierres y exportaciones separan costo de ventas y costo real de cortesías.
- El valor comercial de cortesías queda informativo y no entra en Venta Bruta ni Venta Neta.
- Analítica consume snapshots históricos sin consultar inventario, lotes o reempaque actuales.
- Finanzas muestra costos totales e informa el costo real de cortesías por separado.
- Centro de Mando excluye cortesías de ingresos y Top productos, pero muestra cantidad, valor y costo.
- JSON conserva los registros completos; Firebase y sincronización no recibieron cambios estructurales.
- PWA actualizada a Suite A33 4.20.87 r1; caché POS m31.

## Validaciones

- Smoke A–P: OK.
- Venta C$200 / costo C$80: utilidad C$120.
- Cortesía valor C$200 / costo C$80: ingreso C$0 y utilidad -C$80.
- Lectura legacy `lineCost`, `costTotal`, `costPerUnit × cantidad` y ausencia de costo: OK.
- Sintaxis JavaScript completa: OK.
- Referencias HTML y precaché POS: OK.
- Integridad JSON y archivos Firebase: OK.
