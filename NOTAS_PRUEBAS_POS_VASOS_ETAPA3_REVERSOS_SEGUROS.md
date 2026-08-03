# Suite A33 — POS — Vasos — Etapa 3/4 — Reversos seguros

Fecha de entrega: 03/08/2026

## Cambios
- Restauración exacta del Vaso físico usando únicamente `invEffects.physicalCup` y el movimiento aplicado de Etapa 2.
- Movimiento de reverso determinístico y append-only para impedir doble restauración.
- Cola durable local para completar reversos después de borrado, recarga, offline o reintento.
- Reconciliación de registros anulados/revertidos que conserven trazabilidad moderna.
- Borrado individual, deshacer última venta y eliminación de evento integrados sin inferir por nombre.
- Registros históricos sin trazabilidad moderna permanecen intactos.
- Reempaque, Galón, costos y utilidad no participan en el reverso físico.

## Smoke test ejecutado
- `node --check pos/app.js`: OK.
- VM aislada del contrato físico: venta 1, venta múltiple, cortesía, doble reverso, anulación lógica, cola durable, reintento, insumo ausente/reaparición, histórico y producto sin asociación: OK.
- Resultado final del smoke: stock físico volvió exactamente a su valor inicial; sin duplicados; Galón y producto terminado no fueron modificados por la función física.
- Cache POS: app r47, módulo m51.
