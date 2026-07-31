# Suite A33 — POS — Inventario — Agregar desde lote — Contenido por Letras

## Cambios aplicados

- Selector actualizado a: Lote, Fecha, Contenido, Estado y Acción.
- Nota retirada únicamente del selector de POS; el dato original permanece intacto en Lotes.
- Resumen dinámico construido con la Letra vigente de Catálogo → Productos.
- Selector y aplicación usan una única función para resolver cantidades realmente disponibles.
- Cantidad disponible igual a cero o negativa ya no cae a la producción original.
- Prevención de duplicado del mismo producto y consolidación visual por Letra.
- Confirmación: `Lote aplicado: “CÓDIGO” · CONTENIDO · TOTAL unidad/unidades`.
- Responsive para desktop, iPad horizontal, iPad vertical y móvil, con desplazamiento contenido dentro del modal.
- Release general coordinado: 4.20.97 r4. Caché POS: m45.

## Validación ejecutada

- `node --check` sobre todos los JavaScript modificados.
- Smoke funcional con fixtures reales de contrato Lotes → POS: 2G, 3D, Letra dinámica T, cantidades cero, negativas y fila duplicada.
- Render real de la tabla simulado con DOM funcional: cinco columnas, Contenido visible y Nota ausente.
- Aplicación real de la función de carga: tres movimientos legítimos, total 7, sin duplicados.
- Segundo intento del mismo lote bloqueado sin nuevos movimientos.
- Singular y plural verificados: `1 unidad` y `7 unidades`.
- Nota original conservada después de aplicar el lote.
- Regresiones aprobadas: Cliente Rápido, Efectivo, contratos de disponibilidad de Lotes, código de lote y Centro de Mando.
- PWA verificada por coherencia de release, manifest, query strings, precaché y cache name.
- Módulos protegidos comparados byte a byte contra la base: Lotes, Inventario independiente, Finanzas y Catálogos sin cambios de lógica.

La validación física en Safari/iPad o una PWA instalada requiere dispositivo real. Dentro del entorno se ejecutó smoke funcional automatizado sobre la lógica efectiva de render y carga, no una simple búsqueda de strings.
