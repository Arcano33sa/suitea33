# E4.1 — Corrección de exportaciones de Analítica

Primera de siete subetapas acordadas de la Etapa operacional 4. Autorización: «procede e4.1».

## Objetivo y cambio

Restablecer las exportaciones de resumen, eventos y productos. `downloadExcel` estaba dentro de `downloadCsv`; sus tres llamadores no podían resolverla. Se mueve la llave de cierre para dejar ambas funciones al mismo nivel dentro del módulo. No se cambian fórmulas, nombres de archivos, columnas ni formatos.

## Archivos del alcance

- `analitica/script.js`: corrección del alcance de función.
- `tests/a33-analitica-e41-exportaciones.smoke.cjs`: prueba dirigida.
- `tests/catalogo.json`: registro de la prueba.
- `tests/README.md`: instrucciones y límites de cobertura.
- `tests/RESULTADOS_ETAPA4_1.md`: informe de cierre.

## Validación

- Prueba dirigida aprobada mediante el ejecutor del catálogo. Ejecuta el script completo en VM con DOM simulado y pulsa los tres handlers reales.
- Tres archivos XLSX serializados y leídos nuevamente en memoria con la librería existente de POS: resumen, eventos y productos.
- Comprueba venta neta 80, costo 60, utilidad 20 y costo de cortesía 30 en un escenario con venta, cortesía y devolución; identidad de producto y código de lote `001-A` conservado como texto.
- Sin datos: conserva los tres avisos y no genera archivos. Sin XLSX: conserva los tres avisos de librería ausente y no genera archivos.
- Datos de entrada intactos. No se utiliza IndexedDB ni localStorage real.
- Sintaxis de aplicación y prueba, smoke dirigido y diff revisados.

El primer intento de la prueba detectó que el simulador necesitaba `MutationObserver`; se completó ese adaptador sin modificar la aplicación. La verificación final es VM, no navegador real: no acredita renderizado de avisos, descarga física ni disponibilidad del CDN. No se ejecutó la batería completa ni se revalidaron los siete fallos anteriores.

## Límites y pendientes

Finanzas y Analítica siguen usando XLSX desde CDN; la carga local corresponde a E4.2. No se cambian PWA, Service Workers, cachés, versiones, dependencias, datos, históricos ni respaldos. No se amplían resultados ni se inicia otra subetapa. Sin commit, push o publicación; pendiente revisión manual del usuario.
