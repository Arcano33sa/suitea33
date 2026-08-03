# Suite A33 — POS — Vasos — Etapa 4/4 — Clasificación, compatibilidad histórica y hardening final

Fecha y hora de entrega: 03/08/2026 16:15

## Cambios
- Clasificación estable del Vaso moderno mediante snapshot de producto y asociación `vasoFisicoId`, sin depender solo del nombre.
- Clasificación unificada de Vaso moderno y Vaso legacy únicamente en reportes/categorías que ya distinguen Vasos.
- Separación estricta entre flujo moderno y legacy: un mismo registro no puede activar ambos ni producir doble reverso.
- Finanzas identifica el Vaso desde el contrato/snapshot de la venta; se mantienen intactos los mapeos históricos de las demás presentaciones.
- Se conserva la prioridad de costo existente: Reempaque como fuente principal y costo unitario de catálogo como respaldo, sin sumarlos.
- Reempaque continúa descontando el producto origen y calculando el costo, pero no consume Vasos físicos.
- Compatibilidad histórica preservada para `fractionBatches`, `cupsRemaining`, `fifoBreakdown`, `Vasos 12oz` y ventas legacy.
- Caché POS actualizado a módulo `m52` y `app.js` a revisión `r48`.

## Smoke test ejecutado
- `node --check` sobre todos los archivos JavaScript no vendor: OK.
- Smoke Etapa 4: clasificación moderna/legacy, snapshot estable, Finanzas, venta múltiple, cortesía, producto sin asociación, descuento, reverso, idempotencia, JSON roundtrip, reconciliación, costos, legacy, Firebase, PWA/offline simulado, responsive estructural y regresiones críticas: OK.
- Smoke Catálogos — modales/hardening: OK.
- Smoke POS Efectivo — CDM/créditos: 33/33 controles OK.
- Smoke Vasos Etapa 1 — contrato seguro: OK.
- Service Worker: precache vigente y navegación offline simulada con índice cacheado: OK.
- Validación de assets PWA incluidos: OK.
- Comparación contra la base: solo se modificaron `pos/app.js`, `pos/index.html`, `pos/sw.js` y se agregaron el smoke y estas notas.
- Pruebas históricas con números de caché/revisión fijados a etapas anteriores reportan únicamente esa diferencia esperada; no se usaron como criterio funcional de Etapa 4.
- Renderizado headless real no pudo ejecutarse por política administrativa del navegador del contenedor; la validación responsive se realizó estructuralmente y sin scroll horizontal general.
