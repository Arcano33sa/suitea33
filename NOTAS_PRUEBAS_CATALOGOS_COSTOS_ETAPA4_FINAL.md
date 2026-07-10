# Suite A33 — Catálogos → Costos — Etapa 4/4

## Cambios
- Consumibles Botella y Calcomanía persistidos por `productId`.
- Total derivado en vivo, con estados Completo, Pendiente y Sin receta.
- Resumen compacto de productos visibles/completos/pendientes/sin receta legible.
- Respaldo JSON completo y personalizado con opción Catálogos → Costos.
- Validación de estructura/versión de Costos y compatibilidad con respaldos antiguos.
- Protección de Costos al importar respaldos completos antiguos sin dicho bloque.
- Desactivada la siembra automática de productos al abrir Catálogos; restauración únicamente por botón explícito.
- Galón vigente normalizado a 3720 ml en etiquetas, semillas y metadatos activos, preservando alias legacy.
- Revisiones de caché PWA actualizadas para Catálogos y assets tocados.

## Pruebas técnicas ejecutadas
- `node --check` en JavaScript externo modificado.
- Verificación de referencias de caché y archivos precargados.
- Verificación de ausencia de recreación automática desde `initProducts`.
- Inspección de ZIP final y estructura completa.
