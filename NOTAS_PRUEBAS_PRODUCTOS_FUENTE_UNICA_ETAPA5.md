# SUITE A33 — PRODUCTOS COMO FUENTE ÚNICA — ETAPA 5/8

**Fecha de validación:** 12/07/2026 21:26  
**Base:** SuiteA33_ProductosFuenteUnica_Etapa4_Produccion_Lotes_Dinamicos.zip

## Cambios validados

- POS consume únicamente productos reales, activos, con `productId` y habilitados para POS.
- Planificación de Pedidos consume únicamente productos activos con `productId`.
- Agenda consume únicamente productos activos con `productId` y conserva snapshots históricos al editar.
- Costos genera columnas únicamente para productos activos, con Receta y `productId`.
- Los productos con nombres iguales permanecen separados por `productId`.
- Los históricos conservan nombre, precio y demás snapshots sin convertirse en opciones nuevas.
- Los datos legacy de Costos no se transfieren automáticamente por coincidencia textual.
- El índice de nombre de Productos dejó de ser único; la identidad operativa continúa siendo `productId`.

## Resultado automatizado

**30/30 comprobaciones aprobadas.**

1. Catálogo vacío: POS, Pedidos y Agenda sin opciones; Costos sin columnas.
2. Producto activo y habilitado para POS: visible en POS.
3. Producto activo sin habilitación POS: excluido de POS.
4. Producto activo: visible en Pedidos y Agenda.
5. Producto sin Receta: excluido de Costos.
6. Producto con Receta: visible en Costos.
7. Producto inactivo: excluido de operaciones nuevas.
8. Reactivación: recupera relaciones mediante el mismo `productId`.
9. Renombrado: históricos conservan snapshot; operaciones nuevas muestran nombre actual.
10. Productos con el mismo nombre: no heredan ni fusionan relaciones.
11. Ejecución VM de la lógica operativa sin excepciones.
12. Sintaxis válida en los 37 archivos JavaScript del proyecto.
13. Manifiestos y service workers conservados; revisiones de caché actualizadas en módulos modificados.

## Validaciones adicionales

- 21 archivos HTML parseados correctamente.
- No se agregaron dependencias.
- No se limpiaron datos ni almacenamiento.
- No se eliminaron pedidos, agendas, costos ni históricos.
- Las líneas históricas sin ID se conservan individualmente y no se deduplican por nombre.
