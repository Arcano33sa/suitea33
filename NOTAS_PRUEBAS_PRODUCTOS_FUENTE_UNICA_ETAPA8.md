# Suite A33 — Productos como fuente única — Etapa 8/8

## Hardening final aplicado

- Versión global coordinada: `4.20.87 r1`.
- Referencias compartidas unificadas para A33 Release, Storage, Presentations y Cloud Sync.
- Revisiones funcionales coordinadas para Catálogos, Inventario, Lotes, Pedidos y POS.
- Service Workers activos y precachés alineados por módulo.
- Retiro controlado únicamente de cachés anteriores del mismo módulo y residuos legacy de `centro_mando` / `calculadora_a33`.
- Ninguna limpieza toca `localStorage`, IndexedDB, respaldos JSON ni históricos.
- `calculadora_a33/` quedó como redirección mínima hacia `calculadora/`, sin Storage, producción, inventario, lotes ni Service Worker propios.
- `centro_mando/` quedó como compatibilidad mínima hacia `centro-mando/`, sin scripts, caché ni PWA independiente.
- El inventario terminado del POS ya no crea filas legacy cuando Productos está vacío.
- Receta y habilitación POS dependen de los campos explícitos del Producto, no de nombres históricos.
- FIFO, stock y producción priorizan `productId` estable para impedir herencias entre productos con el mismo nombre.
- La normalización de presentaciones conserva únicamente alias históricos exactos y no convierte nombres libres en productos fijos.

## Validaciones ejecutadas

- Auditoría estática integral: **30/30 comprobaciones aprobadas**.
- Sintaxis JavaScript: **35 archivos validados, 0 fallas**.
- JSON y manifiestos: **13 archivos validados, 0 fallas**.
- Referencias locales HTML: **207 recursos revisados, 0 rutas faltantes**.
- Catálogo vacío: Menú, Catálogos, Calculadoras, Inventario, Lotes, Pedidos, POS, Agenda, Costos, Analítica, Centro de Mando, Finanzas, Configuración y Reportes conservaron **0 Productos**.
- Producto real: visible en Calculadora de Producción, Calculadora Temporal, Inventario, Lotes, Pedidos, POS, Agenda y Costos.
- Producción de 10 unidades: producto terminado `+10`, envase `−10`, tapa `−10`, un lote y protección contra duplicado.
- Inactivación y reactivación: ocultamiento en operaciones nuevas sin perder stock, relaciones ni históricos.
- Borrado y recreación con igual nombre: nuevo `productId`, sin heredar receta, stock, envase, tapa ni históricos.
- JSON parcial/completo y casos sin Productos: no generaron Productos automáticos.
- PWA: cinco registros activos, cinco cachés coordinados, navegación offline aprobada.
- Rutas legacy: redirecciones correctas y sin ejecución de código antiguo.
- Responsive: iPad horizontal, iPad vertical y escritorio sin desbordamiento horizontal.
- Consola: **0 errores críticos de la Suite**. En la prueba aislada se bloquearon deliberadamente recursos externos opcionales de Google Fonts y XLSX CDN; no afectaron la lógica validada.

## Regla final

`Catálogos → Productos` es la única fuente oficial de Productos. `Envases` y `Tapas` permanecen auxiliares independientes para Productos, Inventario y Producción.
