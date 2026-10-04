# Revisión de errores — E2 de 3: Checklist de Calculadora

## Autorización y objetivo

Autorizada mediante «procede e2». Actualizar dos pruebas anteriores al Checklist vigente, conservando las comprobaciones funcionales y separando versiones/publicación. No comprende E3, modificaciones de aplicación, commit ni publicación. Se conservan los cambios pendientes de E1 y sus informes.

## Cambios

- Detalle de letras/sirope: conserva todos los escenarios de letras dinámicas, prioridad de letra histórica, consolidación por producto, escala del sirope, cantidades cero, presentación informativa y ausencia de persistencia/movimientos. Retira únicamente tres exigencias de revisiones históricas exactas de SW/cache/HTML. La coherencia vigente se ejecuta por separado mediante a33-publicacion-coherencia.smoke.cjs.
- Pendientes/histórico: comprueba el orden vigente Pendientes → Checklist → Histórico plegable. Reconoce el cierre explícito con Hecho y exige su presencia solo en pendientes. Conserva clasificación por estado de cierre (marcar todos los checks no cierra automáticamente), Usar/Ver, histórico de consulta, casillas editables del pendiente, estilos y protección de códigos largos.
- El simulador utiliza dependencias reales de Calculadora y el adaptador de avisos existente. No sustituye fórmulas ni lógica de clasificación. El almacenamiento temporal lanza un error si la consulta intenta escribir. Se verifica conservación de los códigos históricos de las filas leídas.
- El catálogo actualiza solamente esas dos entradas a vigente/APROBADA y versionLiterals:false después de comprobarlas. No modifica el estado del fallo de tarjeta/reportes.
- Se reemplaza el mensaje anterior «27/27» sin contador por una descripción precisa de los contratos probados.

## Verificación

- Las dos pruebas corregidas: aprobadas.
- Checklist Etapa 2, hardening Etapa 3 e histórico desplegable: aprobados.
- Coherencia vigente de publicación: aprobada, sin ejecutar publicación ni modificar PWA.
- Chrome E2.4: aprobado. Páginas reales con cierre incompleto bloqueado, cierre completo, recarga y consulta histórica; también verifica Catálogos/Pedidos. Contexto y origen localhost temporales, sin datos reales.
- Tres contrapruebas: modificaciones temporales únicamente en memoria de fórmula de sirope, clasificación de cierre y revisión de caché. Cada prueba pertinente rechazó la alteración con AssertionError. Esto comprueba que retirar revisiones históricas no elimina la detección de desalineaciones actuales.
- Regresión funcional local: **77 aprobadas, 1 fallida y 22 pruebas de navegador omitidas por el ejecutor local**. La prueba Chrome E2.4 se ejecutó aparte y aprobó; las otras 21 no se repitieron. El proceso local termina con código 1 por tarjeta/reportes, pendiente de E3; no se presenta como batería totalmente verde.
- runner.spec.cjs, sintaxis de las dos pruebas modificadas y git diff --check: aprobados.
- Diff revisado: todos los archivos pendientes están en tests/. No hay cambios de aplicación ni cambios fuera del alcance acordado.

Resultados durables: [RESULTADOS_ERRORES_E2.json](RESULTADOS_ERRORES_E2.json). Las ejecuciones anteriores y los informes E1/E5 se conservan sin sobrescribir.

## Archivos propios de E2

- tests/a33-calculadora-checklist-detalle-letras-sirope.smoke.cjs
- tests/a33-calculadora-checklist-etapa1-pendientes-historico.smoke.cjs
- tests/catalogo.json (solo las dos entradas)
- tests/README.md (documentación E2)
- tests/RESULTADOS_ERRORES_E2.md (nuevo)
- tests/RESULTADOS_ERRORES_E2.json (nuevo)

## Límites y cierre

Las comprobaciones locales usan un DOM simulado para clasificación y presentación; Chrome complementa el recorrido vigente. La prueba de fórmulas usa las funciones reales aisladas, no constituye una validación exhaustiva de todas las recetas posibles.

No se modificaron aplicación, interfaz, datos, fórmulas, históricos, respaldos, dependencias, versiones, service workers o cachés. Sin commit ni push.

E2 terminada localmente y detenida para revisión. Queda un fallo: a33-pos-tarjeta-etapa2-integracion-reportes.smoke.cjs, reservado a E3 (comisiones y cierre). E3 no se inició.
