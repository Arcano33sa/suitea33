# E6.6 — Integración de exportaciones y cierre de E6

Fecha: 2026-10-04. Una etapa autorizada: incorporar la comparación de disponibilidad al Excel de demanda y verificar regresión integral de E6.

## Resultado

La exportación demanda_pedidos.xlsx conserva las cuatro hojas existentes, sus columnas y orden: Demanda, Pedidos considerados, Revisión y Período. Añade al final Disponibilidad y Contexto disponibilidad. Usa el mismo cálculo de E6.5: demanda del período agrupada una vez por identidad, saldo central actual y diferencia, separando demanda registrada y estimada. Productos históricos o saldos ilegibles no se vinculan por nombre ni se convierten a cero; las celdas de saldo y diferencia quedan vacías, con Sin confirmar y causa.

El contexto identifica fuente, momento de consulta, reglas y límites: no se suman Lotes/POS, no hay reservas ni descuentos, no se promete disponibilidad futura y los pedidos para revisión quedan fuera. La consulta no es una instantánea atómica entre pestañas. Los Excel generales de Pedidos conservan sus hojas de estados, entregas y vínculos a lotes; la regresión verifica esos flujos existentes. No se alteraron fórmulas comerciales ni datos históricos.

## Archivos de E6.6

- pedidos/script.js: dos hojas adicionales al archivo de demanda.
- tests/a33-pedidos-integracion-e66.browser.smoke.cjs: integración y XLSX sin conexión en almacenamiento temporal aislado.
- tests/catalogo.json: prueba registrada.
- tests/RESULTADOS_ETAPA6_6.md y .json: cierre y evidencia.

Los archivos pendientes de E6.1–E6.5 permanecen intactos fuera de esta adición. Esta etapa no modifica HTML, módulos ajenos, dependencias, PWA, Service Workers, cachés ni versiones. No hubo commit, push o publicación.

## Verificación

Regresión integral: 112/112 APROBADAS, incluidas 28 pruebas Chrome, sin fallidas, bloqueadas o inconclusas. Tres aliases evitados y cero pruebas históricas excluidas. Se conserva el reporte íntegro en RESULTADOS_ETAPA6_6.json.

La nueva prueba Chrome genera bytes XLSX y los vuelve a leer con la red desconectada, comprueba saldo 8 frente a demanda 9 y diferencia -1, separación de estimaciones, históricos sin saldo, celdas vacías y Sin confirmar ante inventario corrupto, contexto de fuente y límites, filtros, cambios desde otra pestaña y conservación de las hojas existentes. También verifica que consultar y exportar no escriben pedidos, históricos ni lotes, y que Inventario POS, ventas, eventos, productos, insumos y reempaques permanecen iguales. Los cambios deliberados del fixture y la entrega registrada para probar actualización usan únicamente almacenamiento temporal aislado.

Smoke de flujos afectados aprobado; runner.spec.cjs, sintaxis de aplicación/prueba y git diff --check aprobados. Diff revisado y captura del panel inspeccionada. No se usaron datos reales.

## Límites y pendientes

El defecto previo ante líneas null en productos de pedidos completos sigue documentado en RESULTADOS_ETAPA6_4.md; requiere alcance y autorización independientes. No se inspeccionaron datos reales. Las seis etapas E6 quedan implementadas localmente para revisión manual del usuario; su aprobación, commit y publicación no se presumen.
