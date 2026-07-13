# Suite A33 — Productos como fuente única — Etapa 2/8

## Cambios verificados

- POS no contiene semillas activas de Productos.
- `seedMissingDefaults()`, normalizaciones de Vaso/Galón y restauración legacy quedaron neutralizadas.
- `ensureDefaults()` conserva Productos vacío y mantiene únicamente defaults legítimos de eventos/bancos.
- La administración legacy de Productos en POS quedó bloqueada y en modo lectura.
- Reempaque solo acepta Productos activos existentes mediante identidad (`id`/`productId`).
- Reempaque no crea, completa, reactiva ni elimina Productos.
- El formulario de Reempaque ya no ofrece creación de destino nuevo.
- PWA/cache del módulo POS fue versionado para publicar la corrección.

## Resultado automático

- 16/16 controles de regresión aprobados.
- Sintaxis JavaScript validada en todos los archivos `.js` del proyecto.
- Cero escrituras directas a `products` desde `pos/app.js` fuera de la creación inicial del esquema IndexedDB.
- Las rutas de escritura/eliminación de ventas históricas permanecen sin cambios.
