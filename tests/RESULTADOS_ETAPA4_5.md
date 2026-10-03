# E4.5 — Analítica: resultados y comisiones

Estado: implementada localmente y verificada; pendiente de revisión del usuario. Sin commit ni publicación.

## Resultado funcional

- Resumen: costo de ventas, utilidad bruta, utilidad después de cortesías (la utilidad anterior), comisiones determinadas y utilidad después de comisión. Detalle de comisiones por etiqueta histórica y conteo de no determinadas.
- Detalle mensual, eventos y productos: resultados después de comisión y conteos de comisiones desconocidas; utilidad bruta por agrupación. Productos también explicita utilidad después de cortesías.
- Comisiones tomadas exclusivamente de `commissionAmountSnapshot`, `commissionLabelSnapshot` y `commissionSnapshotStatus`; normalización de tarjeta/card coherente con POS. Cortesías excluidas; devoluciones conservan el signo guardado; cero determinado es válido. No consulta bancos ni tasas actuales.
- Resultado después de comisión marcado «parcial» cuando existen comisiones no determinadas, en pantalla y exportación.
- Los tres XLSX conservan columnas históricas y agregan indicadores y una hoja `Alcance` con período, fuentes, reglas y límites. Sin cambiar códigos de lote ni identificación histórica de productos.

## Reglas y compatibilidad

Utilidad bruta = ventas netas individuales − costo de ventas pagadas. Utilidad después de cortesías conserva la suma anterior de utilidad de cada línea, incluyendo costos de cortesías. Utilidad después de comisión resta la suma de comisiones determinadas y presenta dos decimales.

Se conserva `computeLineMetrics` y la resolución histórica de costos. No se reescriben ventas ni snapshots. Las comisiones se redondean por línea y en acumulación con la regla de POS; el cálculo histórico anterior de utilidad permanece intacto. Los registros con decimales adicionales se cuentan y advierten, sin corregirlos automáticamente.

La comparación con Finanzas exige igual período y fuentes: Analítica usa ventas individuales; Finanzas reconstruye bruto menos descuentos y puede usar cierres cuando faltan ventas individuales. Un histórico sin descuento guardado puede diferir aunque tenga total neto. La prueba demuestra esa diferencia expresamente (180 en Analítica y 200 en Finanzas); no cambia fórmulas para ocultarla. Merma, ingresos adicionales y gastos de Finanzas están excluidos de E4.5. Márgenes, gráficos de utilidad y recomendaciones conservan la utilidad anterior después de cortesías y antes de comisión.

## Archivos de esta subetapa

- `analitica/index.html`, `analitica/script.js`: indicadores, tablas, notas y XLSX.
- `analitica/sw.js`, `assets/js/a33-build.js`: revisión propia de Analítica 2 y referencia al script r12 para entregar el código ampliado sin conexión mediante el flujo de actualización existente. Sin cambiar versión global ni eliminar cachés.
- Dos pruebas nuevas E4.5, `tests/catalogo.json`, `tests/README.md` y este informe.

El árbol conserva los cambios locales de E4.1–E4.4. Esta subetapa no añade cambios a Finanzas, POS, Configuración ni sus pruebas anteriores. `main` coincide con la referencia local `origin/main` en 722384f; no se hizo fetch, commit ni push.

## Verificación

Ocho pruebas dirigidas aprobadas:

1. `a33-analitica-e45-resultados.smoke.cjs`: funciones actuales de Analítica, recolector de comisión POS y calculador de Finanzas; descuentos, cortesías, devolución, comisión cero, desconocidas, períodos inclusivos, agrupaciones, XLSX real y decimales históricos.
2. `a33-analitica-e45-resultados.browser.smoke.cjs`: Chrome, período personalizado, KPI y etiquetas históricas; conteo desconocido y resultado parcial; tres descargas XLSX sin conexión, contenido verificado; cabeceras y filas alineadas a 1280 y 390 px, sin desbordamiento de página ni errores JavaScript.
3. `a33-analitica-e41-exportaciones.smoke.cjs`: conservación de columnas/importes históricos y tres exportaciones.
4. `a33-exportaciones-e43-workers.smoke.cjs`: precache, revisión y actualización controlada.
5. `a33-exportaciones-e43-apertura-offline.browser.smoke.cjs`: apertura, recarga y pestaña nueva sin conexión; exportaciones y actualización pendiente en Configuración; caché ajena conservada.
6. `a33-finanzas-e44-lecturas.smoke.cjs`: regresión de lecturas y advertencias de Finanzas.
7. `a33-publicacion-coherencia.smoke.cjs`: coherencia de referencias.
8. `a33-pos-vasos-etapa4-reportes-hardening-final.smoke.cjs`: compatibilidad de reportes históricos POS.

Sintaxis de Analítica, inventario del ejecutor y `git diff --check` aprobados. Pruebas con datos en memoria o contexto/origen temporales, sin acceder al almacenamiento real. No se ejecutó la suite completa ni se reinterpretaron los siete fallos anteriores.

## Límites y continuidad

No hay una instantánea atómica entre módulos/pestañas. No se amplía aquí la gestión de errores de lectura de Analítica. La conciliación probada corresponde a fuentes individuales coherentes y al mismo período; no promete igualdad para históricos incompletos, distintas fuentes o reglas de redondeo previas. La merma final y el resultado después de merma pertenecen a E4.6, que no se ejecutó. E4.7 queda pendiente de autorización independiente.
