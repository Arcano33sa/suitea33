# Suite A33 — POS — Inventario — Agregar desde lote — Contenido por Letras

## Cambios aplicados

- Selector conservado como: Lote, Fecha, Contenido, Estado y Acción.
- Nota retirada únicamente del selector; el dato original permanece intacto en Lotes.
- Resolución reforzada de Productos con `productId`, `id` estable, `internalId`, `productInternalId` y `catalogInternalId`.
- Lectura compatible con `cantidadDisponible`, `cantidadDisponibleExiste`, `cantidadProducida`, `cantidadBase` y fuentes contractuales posteriores.
- Un cero disponible confirmado conserva autoridad y no cae a la producción original.
- Una disponibilidad marcada como inexistente permite recuperar la cantidad producida legítima.
- Las fuentes se recorren sin sumar dos veces el mismo producto y sin duplicar Letras.
- Contenido visual separado del estado utilizable; la aplicación continúa protegida por el estado real del lote.
- Selector y aplicación reutilizan la misma función de cantidades y el mismo resumen.
- Confirmación: `Lote aplicado: “CÓDIGO” · CONTENIDO · TOTAL unidad/unidades`.
- Lectura de Productos con cierre y reapertura defensiva de IndexedDB ante conexión inválida, con un solo reintento.
- Release general coordinado: 4.20.97 r5. Caché POS: m46.

## Validación ejecutada

- `node --check` sobre todos los JavaScript modificados.
- Smoke funcional reforzado con variantes reales de identidad de Producto y contrato de Lotes.
- Verificados: `2G 3D 2T`, total 7, Letra dinámica, cero exacto, cero placeholder, `null` sin snapshot, fuente alternativa y fila duplicada.
- Render de cinco columnas con Contenido visible y Nota ausente.
- Aplicación de tres movimientos legítimos, conservación de Nota y bloqueo de una segunda carga.
- Singular y plural verificados: `1 unidad` y `7 unidades`.
- Reapertura defensiva de la lectura de Productos verificada con un único reintento.
- Regresiones funcionales verificadas para Cliente Rápido, Efectivo y contratos de disponibilidad de Lotes, normalizando únicamente las aserciones antiguas de versión al release actual.
- PWA verificada por coherencia de release, manifest, query strings, precaché y nombre de caché.

El navegador Chromium disponible en el entorno bloquea por política organizacional los enlaces locales y `file://`; por ello no se declara una prueba física de PWA instalada. La validación ejecutada cubre la lógica efectiva de lectura, render, carga, persistencia simulada y prevención de duplicados, no una simple búsqueda de strings.
