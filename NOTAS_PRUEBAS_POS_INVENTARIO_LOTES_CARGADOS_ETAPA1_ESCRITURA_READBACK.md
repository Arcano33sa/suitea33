# Suite A33 — POS — Inventario — Lotes cargados — Etapa 1/2

## Alcance aplicado

- Carga normal de lotes nuevos mediante una sola transacción `readwrite` sobre `inventory`.
- Confirmación por `transaction.oncomplete` antes de continuar.
- Readback real por `loteCargaId` / `loteGroupKey` con validación de evento, lote, producto, Letra, cantidad, origen, tipo y fecha.
- Asignación del lote y `assignmentHistory` únicamente después del readback correcto.
- Render único de Inventario con actualización inmediata del contador y la fila.
- Conexión separada para lecturas frescas, promesa compartida y reintento único sin cerrar la conexión global durante escrituras.
- Rollback controlado de Inventory y de la asignación recién creada si falla un paso posterior.
- Reempaque e históricos anteriores sin reconstrucción ni cambios de lógica.

## Pruebas ejecutadas

- `node --check`: `pos/app.js`, `pos/sw.js`, `assets/js/a33-release.js`, `assets/js/a33-build.js`.
- Smoke técnico: `tests/a33-pos-lotes-cargados-etapa1-escritura-readback.smoke.cjs`.
- Smoke de compatibilidad de importación/readback histórico: `tests/a33-pos-importacion-readback-historico-fix.smoke.cjs`.
- Smoke de regresión de Lotes dinámicos Etapa 2/2 con versionado actual.
- Prueba real en Chromium con IndexedDB:
  - carga de dos productos en una sola operación;
  - confirmación de `transaction.oncomplete`;
  - readback correcto;
  - asignación posterior al readback;
  - contador y fila inmediatos;
  - persistencia al salir/volver, recargar y cerrar/abrir;
  - persistencia offline mediante Service Worker;
  - aborto controlado en el segundo `put`, sin carga parcial ni asignación;
  - movimientos `adjust` de Reempaque excluidos de Lotes cargados;
  - desktop, iPad horizontal, iPad vertical y móvil en modo claro/oscuro, sin scroll horizontal general.

## Evidencia

- `tests/results/a33-pos-lotes-etapa1-browser.json`
- Resultado general: **PASS**.
