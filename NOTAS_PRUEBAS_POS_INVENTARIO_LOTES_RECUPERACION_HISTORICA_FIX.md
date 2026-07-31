# Suite A33 — POS — Inventario — Recuperación histórica de lotes

Fecha y hora de entrega: 30/07/2026 18:36

## Resultado

- Se agregó un puente exclusivamente de lectura entre `inventory` de IndexedDB y `arcano33_lotes`.
- Se normaliza `eventId` numérico/texto y se usa nombre exacto del evento solo como respaldo.
- Se recuperan asignaciones desde `assignmentHistory`, `assignedEventId`, `assignedEventName` y `eventUsage`.
- Se deduplican cargas modernas e históricas sin sumar cantidades duplicadas.
- Se conserva la resolución dinámica por `productId`, Letra y compatibilidad P/M/D/L/G.
- Los productos históricos huérfanos conservan nombre/Letra cuando existe evidencia.
- No se escriben movimientos, existencias, IndexedDB, localStorage, Firebase ni JSON durante la lectura/render.
- Release general: `4.20.97 r6`.
- Caché POS: `m48`.

## Smoke tests ejecutados

- `node --check pos/app.js`
- `node --check pos/sw.js`
- `node --check assets/js/a33-release.js`
- `node --check assets/js/a33-build.js`
- `tests/a33-pos-inventario-lotes-recuperacion-historica-fix.smoke.cjs`
- `tests/a33-pos-inventario-lotes-dinamicos-etapa1.smoke.cjs`
- `tests/a33-pos-inventario-lotes-dinamicos-etapa2-hardening-final.smoke.cjs`
- `tests/a33-pos-lotes-cargados-shell-cache-fix.smoke.cjs`

Resultado: OK.
