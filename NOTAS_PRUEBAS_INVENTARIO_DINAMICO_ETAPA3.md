# Suite A33 Inventario Dinámico — Etapa 3/3

Fecha y hora de entrega: 22/06/2026 07:38

## Cambios aplicados

- Se reforzó la Calculadora de Producción para validar existencias de envases y tapas/corchos antes de guardar producción real.
- La producción ahora descuenta el envase dinámico asociado al producto por `envaseId`.
- La producción ahora descuenta la tapa/corcho dinámico asociado al producto por `tapaId`.
- Se bloquea el guardado si el consumo de envases/tapas dejaría inventario negativo.
- Se conserva el aumento de producto terminado por `productId` y compatibilidad legacy P/M/D/L/G.
- Se agregan movimientos técnicos de inventario con origen `calculadora-produccion` para consumos automáticos de envases/tapas.
- Catrina no tiene excepción: si tiene envase y corcho asignados, ambos se consumen por separado.
- POS no fue modificado para descontar envases/tapas; sigue vendiendo producto terminado.

## Pruebas estáticas realizadas

- `node --check` sobre script inline de `calculadora/index.html`.
- `node --check inventario/script.js`.
- `node --check pos/app.js`.
- `node --check lotes/script.js`.
- `node --check catalogos/script.js`.

## Observaciones

- No se borró localStorage ni IndexedDB.
- No se agregaron dependencias, Firebase ni backend.
- No se recalculan lotes ni ventas históricas.
