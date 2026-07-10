# Suite A33 POS — Inventario dinámico Etapa 3

Cambios aplicados:
- POS ajusta inventario central de producto terminado por Product ID para productos nuevos, manteniendo compatibilidad legacy en pulso/media/djeba/litro/galon.
- Productos sin manejo de inventario no intentan descontar stock central.
- La reversión por eliminación de venta usa el mismo adaptador productId/legacy.
- Lotes → POS lee contrato dinámico por productId cuando existe y conserva fallback legacy P/M/D/L/G.
- Cache PWA POS actualizada para cargar app.js nuevo.

Validación técnica:
- node --check pos/app.js
- node --check pos/sw.js
