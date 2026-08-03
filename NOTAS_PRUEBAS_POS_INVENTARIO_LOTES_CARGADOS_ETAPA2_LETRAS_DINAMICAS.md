# POS · Inventario · Lotes cargados · Etapa 2/3

- Encabezados dinámicos: Código, Fecha y Letras válidas del catálogo/histórico.
- Identidad histórica centralizada por productId estable, internalId, Letra y nombre legacy controlado.
- Deduplicación por identidad dentro de cada carga.
- Conflictos de Letras activas detectados y señalados con ⚠, sin suma silenciosa.
- Render histórico de solo lectura; sin escrituras ni migraciones.
- PWA POS: revisiones de index/styles/app y caché de módulo incrementadas.
