# Suite A33 Inventario Dinámico — Etapa 1/3

Cambios aplicados:
- Inventario ahora lee visualmente envases/botellas activos desde `a33_catalog_envases_v1`.
- Inventario ahora lee visualmente tapas/corchos activos desde `a33_catalog_tapas_v1`.
- Se mantiene compatibilidad legacy para Pulso, Media, Djeba, Litro, Galón y tapas agrupadas.
- Se evita duplicar visualmente los ítems legacy cuando también existen en Catálogos.
- Catrina y Corcho Catrina aparecen si están activos en Catálogos.
- No se modificó la lógica de Producción, POS, Lotes ni Finanzas.

Validación técnica:
- node --check inventario/script.js
- node --check inventario/sw.js
- node --check catalogos/script.js
- node --check lotes/script.js
- node --check pos/app.js
- node --check assets/js/a33-storage.js
- Prueba VM local: lectura de Botella Catrina y Corcho Catrina desde Catálogos, sin duplicar Pulso/Tapa Galón legacy.
