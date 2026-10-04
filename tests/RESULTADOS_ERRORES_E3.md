# Revisión de errores — E3 de 3: comisiones y cierre

## Autorización y alcance

Autorizada mediante «procede e3». Actualizar la última prueba pendiente al resultado económico vigente con merma y verificar el catálogo completo. No se autorizó modificar fórmulas ni aplicación. Se conservan los cambios e informes pendientes de E1/E2. Sin commit, push ni publicación.

## Cambios

La prueba a33-pos-tarjeta-etapa2-integracion-reportes.smoke.cjs conserva sus casos de comisión por snapshot, multibanco, ausencia de comisión para otros pagos, backfill histórico confiable/no determinado, idempotencia ante cambio posterior de tasa, preservación de datos, separación de costos/gastos/Caja/Bancos, reportes y respaldo JSON.

Se sustituye la exigencia textual de la fórmula anterior sin merma por ejecución del cálculo real de Finanzas. El escenario combina una venta de tarjeta por 3190, costo comercial 1000, costo de cortesía 50, comisión 223.30, ingresos adicionales 80, gastos 30 y merma final 25. Comprueba utilidad neta 1941.70; sin merma es 1966.70. La diferencia es exactamente 25. Se verifica que la merma no altera venta, costo de venta, cortesías, comisión, gastos ni movimiento de Caja/Bancos, que no se cuentan mermas canceladas o fuera de período, y que las fuentes permanecen intactas.

Los ingresos/gastos manuales se aportan como fuente aislada común a ambos cálculos; este nuevo escenario no pretende probar su clasificación interna. La integración completa existente E4.7 se ejecutó en Chrome para complementar esa cobertura.

Se retiran cinco expectativas históricas exactas de versiones de POS/Finanzas. La prueba de coherencia vigente de publicación se ejecuta separadamente en el mismo catálogo; no se modifican PWA, service workers, cachés ni versiones.

La última entrada del catálogo pasa a vigente/APROBADA y versionLiterals:false únicamente tras comprobarla. No se eliminan pruebas ni se excluyen históricos para alcanzar un resultado aprobado.

## Verificación final

| Comprobación | Resultado |
|---|---|
| Catálogo completo, funcional y publicación | **101 aprobadas de 101** |
| Pruebas de navegador incluidas | **22 aprobadas de 22** |
| Fallidas, omitidas, inconclusas o bloqueadas | **0** |
| Pruebas históricas excluidas | **0** |
| Aliases | 3, sin ejecuciones duplicadas |
| Contrapruebas numéricas E3 | 3 alteraciones detectadas |
| runner.spec.cjs | Aprobado |
| Sintaxis de la prueba modificada | Aprobada |
| git diff --check | Aprobado |

El ejecutor finalizó con código 0. De las 101 comprobaciones, 100 pertenecen al grupo funcional y una a coherencia de publicación. Las 22 pruebas de navegador incluyen recuperación/guardado seguro E5, conflictos, importación/exportación y diagnóstico de respaldos, navegación, compra normal POS, merma, conciliación POS/Finanzas/Analítica, exportación sin conexión y PWA según los escenarios declarados.

Las contrapruebas interceptaron lecturas en memoria para omitir merma, duplicar comisión y omitir costo de cortesías en el cálculo. Cada modificación se rechazó con AssertionError por resultados numéricos, sin escribir archivos de aplicación ni datos reales.

Las pruebas utilizan almacenamiento en memoria o contextos/orígenes temporales de localhost. No se abrieron perfiles ni datos reales del usuario. No se publicó nada al ejecutar la comprobación de publicación.

Registro completo y salidas: [RESULTADOS_ERRORES_E3.json](RESULTADOS_ERRORES_E3.json). Informe original temporal: /tmp/a33-errores-e3-integrada.json.

## Archivos de E3

- tests/a33-pos-tarjeta-etapa2-integracion-reportes.smoke.cjs
- tests/catalogo.json (solo la entrada correspondiente)
- tests/README.md (documentación de cierre)
- tests/RESULTADOS_ERRORES_E3.md (nuevo)
- tests/RESULTADOS_ERRORES_E3.json (nuevo)

Diff revisado: todos los archivos pendientes del trabajo E1–E3 pertenecen a tests/. No hubo cambios de aplicación, interfaz, fórmulas, producción, inventario, datos persistidos, respaldos, históricos, dependencias o componentes sensibles. Los informes anteriores que documentan siete fallos se conservan como evidencia de aquellas ejecuciones.

## Cierre y límites

Los siete fallos anteriores quedan resueltos como expectativas y simuladores desfasados de pruebas, con comprobación de contratos vigentes. No se presenta este trabajo como siete correcciones de errores de producción.

La batería aprobada cubre los escenarios declarados; no garantiza todos los estados posibles ni elimina los límites documentados de almacenamiento, recuperación y simultaneidad entre pestañas. E1 conserva cobertura de estilos para códigos largos, sin un recorrido visual nuevo específico de esos códigos.

Las tres etapas propuestas para la revisión de fallos se completaron localmente, cada una con autorización independiente. Se detiene para revisión del usuario. Sin commit ni push; no se inicia automáticamente la Etapa operacional 6.
