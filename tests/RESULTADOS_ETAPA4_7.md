# E4.7 — Verificación integrada y cierre de la Etapa operacional 4

Séptima de las siete subetapas acordadas. Autorización: «procede e4.7».

Estado: verificación local completada, pendiente de revisión manual del usuario. Las siete subetapas están implementadas/verificadas localmente. No se hizo commit, push ni publicación; no se inició la Etapa 5.

## Resultado del cierre

**86 pruebas únicas ejecutadas: 79 aprobadas y los mismos siete fallos anteriores.** Las 15 pruebas de navegador aprobaron. Ninguna prueba omitida, bloqueada o inconclusa; ninguna histórica excluida; tres alias sin duplicar.

La batería completa sigue sin estar totalmente aprobada. Los siete fallos no se silencian ni se reclasifican como aprobados y no prueban por sí solos un defecto operacional. No se modificaron fórmulas para satisfacer esas expectativas.

Se ejecutaron dos tandas sobre el mismo código de aplicación:

1. Catálogo completo previo a añadir la prueba integrada E4.7: 85 pruebas, 78 aprobadas y 7 fallidas, con las 14 pruebas de navegador existentes incluidas. `run-suite.cjs --browser --timeout-ms 60000` terminó con código 1 debido a esos siete fallos.
2. Nueva prueba integrada, registrada y ejecutada mediante el mismo ejecutor: 1 aprobada, código 0. El consolidado contiene las 86 pruebas únicas del catálogo final, sin duplicados.

Registro con resultados individuales, mensajes de fallos, tiempos y hashes del código comprobado: [RESULTADOS_ETAPA4_7.json](RESULTADOS_ETAPA4_7.json). Los originales de ambas tandas quedan en `/tmp/a33-e47-regresion-20261003.json` y `/tmp/a33-e47-integrada-20261003.json`.

## Conciliación comprobada

La nueva prueba usa un origen localhost aleatorio y un contexto temporal de Chrome. Finanzas y Analítica se abren como páginas reales sobre las mismas fuentes persistidas. POS aporta sus funciones actuales de reporte, resolución de costos, descuentos, comisión y acumulación de merma; el adaptador de prueba únicamente realiza lecturas de IndexedDB. No se inicializa la interfaz completa de POS en esta comprobación específica; los recorridos POS del catálogo completo se ejecutaron por separado.

Con el mismo período inclusivo, fuentes individuales completas y snapshots coherentes:

| Indicador | Importe C$ verificado |
|---|---:|
| Venta neta | 300.00 |
| Costo de ventas | 90.00 |
| Costo de cortesías | 30.00 |
| Utilidad bruta | 210.00 |
| Utilidad después de cortesías | 180.00 |
| Comisiones determinadas | 4.00 |
| Utilidad después de comisión | 176.00 |
| Merma final confirmada | 7.00 |
| Utilidad después de comisión y merma | 169.00 |

Se incluyen descuento, cortesía, devolución con comisión negativa, comisión cero determinada, efectivo, transferencia y dos eventos. Precios/costos del catálogo y tasa/nombre actuales del banco son deliberadamente distintos de los guardados; no sustituyen snapshots. Ventas fuera del período y merma provisional/anulada se excluyen. Un cierre de 9999.00 para un día con ventas individuales no duplica los ingresos en Finanzas.

También se verifican diferencias legítimas de alcance, mediante el calculador actual de Finanzas con fuentes adicionales en memoria:

- Un ingreso adicional de 10.00 y gasto de 4.00 llevan Finanzas a 175.00; Analítica conserva 169.00 porque esos movimientos quedan fuera de su alcance.
- Un cierre sin ventas individuales, con venta neta 20.00 y costo 2.00, lleva Finanzas a 187.00. Analítica usa las ventas individuales; esa diferencia no se interpreta como fallo de fórmula.
- Una venta con comisión no determinada conserva el importe calculable 70.00 y el conteo de una comisión desconocida en POS/Finanzas; Analítica muestra el resultado parcial.
- Un período con solo merma final de 8.00 produce resultado −8.00 en Finanzas y Analítica.

La regresión E4.5 también conserva la diferencia demostrada de históricos sin descuento guardado y los avisos por decimales adicionales. No se promete igualdad para fuentes, períodos o registros históricos diferentes.

## Exportaciones, offline y lecturas

- Las tres descargas XLSX de Analítica se leen con la biblioteca real y se comparan con los indicadores. Eventos suma 169.00 después de merma; Productos suma 176.00 antes de merma, conservando la regla de no repartir merma entre productos. Hojas `Alcance` y `Merma final` presentes, columnas y códigos de lote anteriores conservados.
- Se ejecuta la exportación real `exportBalanzaReportExcel` de Finanzas, con un asiento aislado equilibrado; se descarga sin conexión y se comprueban DEBE/HABER de 300.00 y diferencia cero. No se presenta este reporte contable como equivalente al tablero operacional.
- E4.2/E4.3 vuelven a comprobar XLSX local, apertura y recarga offline, pestaña nueva, cachés independientes y actualización pendiente en Configuración. La actualización controlada y las pruebas PWA anteriores también aprobaron.
- E4.4/E4.6 vuelven a comprobar vacío frente a error de lectura, base/esquema históricos, error principal, aborto tardío, avisos y recuperación. Costos de merma no fiables o lectura fallida no se presentan como resultado completo.
- E4.5/E4.6 verifican tablas alineadas y sin desbordamiento de página en escritorio y móvil.
- El catálogo completo revalidó también los flujos POS/Pedidos/Catálogos/Checklist y las seis pruebas de navegador de protección de datos que no se habían repetido en los cierres parciales.

## Siete fallos anteriores conservados

| Prueba | Expectativa pendiente ya documentada |
|---|---|
| `a33-agenda-purchases-grouped-stage3-final.smoke.cjs` | Literal de integración de compras en Centro de Mando. |
| `a33-calculadora-checklist-detalle-letras-sirope.smoke.cjs` | Revisión histórica del registro SW. |
| `a33-calculadora-checklist-etapa1-pendientes-historico.smoke.cjs` | Orden visual anterior del Checklist. |
| `a33-catalogos-vistas-independientes-etapa1.smoke.cjs` | Marcador anterior de historial de navegación. |
| `a33-lot-code-stage5.smoke.cjs` | Texto antiguo de Configuración. |
| `a33-lot-code-stage6.smoke.cjs` | Selector CSS anterior de Centro de Mando. |
| `a33-pos-tarjeta-etapa2-integracion-reportes.smoke.cjs` | Fórmula literal sin merma y expectativas históricas de publicación. |

Son los mismos archivos y motivos registrados en E2/E3. La nueva conciliación funcional complementa la evidencia de la prueba de tarjeta, pero no cambia ni oculta su resultado fallido. Referencia: [RESULTADOS_ETAPA2_4.md](RESULTADOS_ETAPA2_4.md).

## Cambios y revisión de E4.7

Esta subetapa cambia únicamente:

- `tests/a33-e47-conciliacion-integrada.browser.smoke.cjs`: nueva verificación integrada.
- `tests/catalogo.json`, `tests/README.md`: registro y descripción.
- Este informe y `tests/RESULTADOS_ETAPA4_7.json`: evidencia de cierre.

No añade cambios al código de aplicación, dependencias, PWA, versiones o almacenamiento productivo. Los cambios locales E4.1–E4.6 permanecen pendientes de revisión/commit. Se revisó el diff acumulado y los dos nuevos workers; se conservan la ruta canónica `centro-mando/`, código POS, vendor XLSX, versión global y datos históricos.

Sintaxis aprobada para 18 archivos de aplicación/pruebas E4. `runner.spec.cjs` y `publication-contract.spec.cjs` aprobados: catálogo, deduplicación, fallos/bloqueos/tiempos y contrapruebas de publicación. `git diff --check` aprobado. La nueva prueba requirió completar una constante POS en el simulador y usar el campo vigente `baseAmountNio` en su fixture financiero; esos intentos no requirieron cambios productivos.

Todas las pruebas usan datos en memoria o contextos/orígenes temporales. La nueva integración compara los siete almacenes POS completos antes/después y comprueba que permanecen intactos. No se abren perfiles ni datos del usuario y no se accede a producción.

## Límites que siguen vigentes

- Conciliar exige comparar períodos, fuentes y reglas; Analítica no incorpora movimientos adicionales de Finanzas ni cierres alternativos.
- Las lecturas no constituyen una instantánea atómica entre bases o pestañas. Analítica necesita recarga para incorporar cambios posteriores.
- Se conservan históricos incompletos y reglas previas de redondeo; volumen/costos históricos pueden diferir según módulo. No se recalculan snapshots ni se reparte merma entre productos.
- Esta etapa no amplía el mecanismo general de errores de lectura de ventas/productos en Analítica ni verifica todos los reportes contables posibles.
- Las pruebas no sustituyen la revisión manual con datos reales. Los siete contratos de prueba anteriores siguen pendientes de acuerdo independiente.
- Siguen vigentes las limitaciones de respaldo/importación de E3: sin transacción global ni instantánea atómica; solicitar una descarga no confirma su guardado; diagnóstico de almacenamiento no garantiza escrituras futuras.

Las siete subetapas de la Etapa 4 quedan cerradas técnicamente a nivel local para revisión del usuario. Se detiene el trabajo; no se solicita ni ejecuta commit automáticamente y no se inicia la siguiente etapa operacional.
