# Suite A33 — Lotes Compatibilidad Histórica Etapa 3/4

Fecha y hora de entrega: 21/06/2026 20:56

## Cambios aplicados

- Se agregó lectura canónica defensiva para productos de lote.
- Se mantiene compatibilidad histórica con campos legacy: pulso, media, djeba, litro y galon.
- Se conservan letras legacy P/M/D/L/G sin recalcular históricos.
- Se prioriza estructura dinámica válida cuando existe.
- Se agregan campos legacy faltantes solo si la misma Letra no existe ya en la estructura dinámica, evitando duplicación.
- Se permite visualización mixta, por ejemplo P/G desde legacy y C desde estructura dinámica.
- Se actualizó visualización compacta de lote a formato por Letra: P: 10 · C: 12.
- Se ajustaron listado, tarjetas, detalle, histórico y exportación Excel de Lotes para usar lectura canónica.
- Se agregó lectura defensiva de remainingByKey para lotes asignados/en evento.
- Se actualizó cache/versionado del módulo Lotes a r10 para reflejar los cambios nuevos.

## Pruebas realizadas

- node --check lotes/script.js
- node --check lotes/sw.js
- node --check assets/js/a33-storage.js
- node --check inventario/script.js
- node --check pos/app.js
- node --check finanzas/script.js
- Prueba lógica en Node VM para lote legacy puro, lote dinámico puro, lote mixto y lote duplicado legacy/dinámico.

## Resultado de prueba lógica

- Legacy puro: P: 10 · D: 2 · G: 1
- Dinámico puro: C: 12
- Mixto: P: 10 · G: 1 · C: 12
- Duplicado P legacy + P dinámico: P: 10 · C: 12
- Remanente por evento: P: 3 · C: 8
