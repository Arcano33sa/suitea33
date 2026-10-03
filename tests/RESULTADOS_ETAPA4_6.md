# E4.6 — Merma final y resultado después de merma

Estado: implementada y verificada localmente; pendiente de revisión del usuario. No se hizo commit, push ni publicación. E4.7 no se ejecutó.

## Resultado funcional

- Analítica consulta `a33-pos.reempaques` mediante una transacción de solo lectura y espera su terminación. No crea ni migra el almacén.
- Resumen muestra costo y volumen de merma final confirmada y utilidad después de comisión y merma. La utilidad anterior y las comisiones permanecen intactas.
- Detalle mensual y por evento agrega merma y resultado después de merma. Incluye períodos y eventos con merma aunque no tengan ventas: su utilidad puede ser negativa.
- Los tres XLSX agregan una hoja `Merma final` con ID, fecha, evento, volumen, costo y estado del costo. Resumen y Eventos agregan resultados después de merma, preservando las columnas anteriores.
- La merma del evento no se reparte entre productos. Su tabla y hoja principal conservan resultados antes de merma; el alcance lo explica.

## Reglas y compatibilidad

Se incluyen registros con `tipo === 'REEMPAQUE_MERMA_FINAL_EVENTO'` o `isFinalEventMerma === true`. Se excluyen `provisionalClose`, `anulado`, `cancelled` y estado `ANULADO`. No se deduce merma de ventas, remanentes pendientes, cortesías, inventario ni tasas actuales.

La fecha sigue las fuentes del tablero de Finanzas: `dateISO`, `fecha`, `date`, `dayKey`, `dateKey`, `createdAtISO`, `createdAt`. Los límites del período son inclusivos. Los registros sin fecha se incluyen únicamente en «Todo el histórico» y se muestran en «Sin fecha» en el detalle mensual; no se les inventa una fecha económica.

Costo: `costoMermaFinal`, `finalMermaCost` o `economicCost`. Volumen: `mermaFinalMl` o `finalMermaMl`. Se conservan importes registrados y se acotan negativos a cero, como Finanzas. La acumulación se presenta con dos decimales, siguiendo el tablero de Finanzas; no recalcula el costo con productos o inventario actuales.

Resultado después de merma = resultado después de comisión de E4.5 − costo de merma final confirmado del mismo período/evento.

Un costo ausente, inválido o con `costReliable === false` marca el resultado como parcial. Una lectura fallida no se acredita como vacía: el indicador principal dice «No disponible» y el resultado después de merma es parcial; XLSX identifica el estado de lectura. Un almacén ausente se reconoce como esquema histórico sin merma registrada, sin crearlo ni alterar datos. Las comisiones desconocidas también mantienen el resultado final parcial.

Los ID de evento históricos de tipo número y texto conservan sus agrupaciones previas de ventas. La merma se atribuye una sola vez a la primera agrupación correspondiente, evitando duplicar su costo por esa diferencia de tipos.

## Archivos de E4.6

- `analitica/script.js`, `analitica/index.html`: lectura, indicadores, agrupaciones y XLSX.
- `analitica/sw.js`, `assets/js/a33-build.js`: script de Analítica r13 y revisión propia 3, para entregar esta ampliación sin conexión mediante actualización controlada. No se modificó la versión global ni se eliminaron cachés.
- `tests/a33-analitica-e46-merma.smoke.cjs`, `tests/a33-analitica-e46-merma.browser.smoke.cjs`, catálogo, README y este informe.

La revisión se hizo contra el estado anterior a E4.6 y el diff acumulado. Los cambios de E4.1–E4.5 continúan pendientes en el árbol; E4.6 no añade cambios en Finanzas, POS, Configuración ni datos persistentes.

## Verificación

Ocho pruebas dirigidas aprobadas:

1. `a33-analitica-e46-merma.smoke.cjs`: conciliación de merma y resultado con el calculador actual de Finanzas; fechas límite, exclusiones, eventos sin ventas, agrupaciones históricas, ausencia de reparto por producto, costos inciertos, esquema histórico, fallo síncrono, resultado inválido, aborto tardío y XLSX real. Datos intactos.
2. `a33-analitica-e46-merma.browser.smoke.cjs`: Chrome con origen y almacenamiento temporales; KPI y tablas, eventos y meses sin ventas, costos no fiables y error real de `getAll`; tres descargas XLSX sin conexión con contenido verificado; cabeceras alineadas y sin desbordamiento de página a 1280/390 px; ventas y reempaques intactos, sin errores JavaScript.
3. `a33-analitica-e45-resultados.smoke.cjs`: conservación de resultados y comisión histórica, conciliación previa y exportaciones.
4. `a33-analitica-e41-exportaciones.smoke.cjs`: tres exportaciones y columnas/importes históricos.
5. `a33-exportaciones-e43-workers.smoke.cjs`: precache, revisión, aislamiento y activación controlada.
6. `a33-exportaciones-e43-apertura-offline.browser.smoke.cjs`: apertura/recarga/pestaña nueva offline, exportaciones, actualización pendiente en Configuración y conservación de caché ajena.
7. `a33-finanzas-e44-lecturas.smoke.cjs`: regresión de lecturas y advertencias financieras.
8. `a33-publicacion-coherencia.smoke.cjs`: coherencia de referencias.

Sintaxis de script/worker, inventario del ejecutor y `git diff --check` aprobados. No se ejecutó la suite completa ni se reinterpretaron los siete fallos anteriores.

## Límites

No hay una instantánea atómica entre bases o pestañas. Los datos se consultan al abrir Analítica; para incorporar cambios posteriores se requiere recargar. El resultado sigue excluyendo ingresos adicionales y gastos de Finanzas y no sustituye un estado financiero completo.

Los históricos con fechas/costos incompletos o decimales adicionales pueden diferir entre módulos. POS conserva ciertos acumulados de volumen con cuatro decimales y acumulaciones distintas; E4.6 sigue el tablero de Finanzas, sin modificar reglas POS. Las comisiones y cálculos históricos de E4.5 mantienen sus límites documentados. Las lecturas generales de ventas/productos de Analítica conservan su mecanismo previo; esta subetapa protege específicamente la nueva lectura de merma.

Pendiente: revisión manual del usuario y autorización independiente de E4.7.
