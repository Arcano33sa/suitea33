# E6.5 — Disponibilidad informativa con Inventario

Fecha: 2026-10-04. Una etapa autorizada: comparar demanda del período con saldo central, sin reservas ni movimientos.

## Resultado y compatibilidad

Pedidos muestra una tabla adicional dentro del panel de demanda. Agrupa todas las fechas filtradas por identidad de producto y utiliza el saldo actual de `arcano33_inventario.finishedByProductId` una sola vez. Diferencia = saldo menos demanda pendiente registrada y estimada. No distribuye existencias por fecha ni promete disponibilidad futura. Los pedidos para revisión quedan fuera, como en E6.4.

Un saldo numérico cero o negativo es válido y se conserva. Lecturas fallidas, inventario ausente, estructura antigua sin saldos identificados, producto sin saldo, identidad contradictoria y cantidades inválidas muestran Sin confirmar; nunca se sustituyen por cero. Los productos históricos sin identidad permanecen separados y no se vinculan por nombre. No se migra ni modifica el inventario heredado.

Los saldos de Lotes y POS no se suman: son fuentes relacionadas con el mismo inventario y podrían duplicarlo. Actualizar, cambiar fechas, abrir el panel y recibir cambios de Inventario desde otra pestaña recalculan la comparación. No se persisten filtros ni se crean claves. La exportación de demanda existente permanece igual; integración de exportaciones corresponde a E6.6, pendiente de autorización.

## Archivos de esta etapa

- pedidos/index.html: tabla y explicación del alcance.
- pedidos/script.js: lectura estricta, agrupación y comparación de solo lectura, actualización por storage.
- tests/a33-pedidos-disponibilidad-e65.smoke.cjs y variante .browser.smoke.cjs: modelo y Chrome con almacenamiento temporal aislado.
- tests/catalogo.json y este informe con su JSON de resultados.

Los cambios pendientes anteriores de E6.1–E6.4 se conservaron. No se modificaron en esta etapa assets/js/a33-storage.js, centro-mando/app.js ni configuracion/script.js. No hubo cambios en PWA, Service Workers, cachés, versiones, dependencias o infraestructura; tampoco commit ni push.

## Límites

Demanda e inventario no se leen en una instantánea atómica entre pestañas. La comparación incluye estimaciones y excluye pedidos para revisión; consultar sus fuentes sigue siendo necesario. El defecto previo de arranque ante líneas null en pedidos completos permanece documentado en RESULTADOS_ETAPA6_4.md y requiere autorización independiente. No se inspeccionaron ni alteraron datos reales.

## Verificación

Regresión integral: 110 aprobadas y una falla de la nueva prueba Chrome por seleccionar la primera fila histórica en lugar del producto identificado. Se corrigió exclusivamente el selector del fixture, sin cambiar código de aplicación; cierre dirigido: 2/2 aprobadas, incluida Chrome. Resultado combinado: las 111 pruebas del catálogo están verificadas, 27 de navegador. No se repitieron las 110 ya aprobadas porque solo cambió la selección de fila del test.

Modelo: demanda sumada entre fechas, estimaciones, déficit, cero, saldo negativo, números históricos, identidad contradictoria, lecturas denegadas y estructuras incompletas. Chrome: pantalla, filtro, inventario modificado desde otra pestaña, fuente corrupta sin falsos ceros, exportación E6.4 conservada y ausencia de cambios en datos operacionales. Smoke aprobado y captura inspeccionada. Sintaxis, runner.spec.cjs y git diff --check aprobados. Diff revisado: cambios de esta etapa limitados a los archivos enumerados.

Los reportes originales de regresión y cierre se conservan juntos en RESULTADOS_ETAPA6_5.json.
