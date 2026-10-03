# E4.4 — Distinguir lecturas incompletas de fuentes vacías en Finanzas

Cuarta de siete subetapas acordadas. Autorización: «procede e4.4».

## Objetivo y resultado

El tablero financiero conserva los importes disponibles y sus fórmulas, pero identifica una lectura incompleta mediante un aviso visible antes de los resultados. El aviso indica la fuente afectada, declara que los importes son parciales y desaparece después de una lectura correcta. Si falla la carga financiera principal, advierte que los valores visibles no fueron actualizados y conserva el manejo de error existente.

La lectura POS del tablero usa una conexión independiente, sin solicitar versión ni modificar esquema. Si la base no existe, aborta su creación inicial; no crea una base vacía. Espera `transaction.oncomplete` antes de publicar filas: un aborto posterior al éxito de `getAll` no se acredita como lectura completa. Distingue por almacén lectura con registros, lectura vacía, ausencia de almacén, base no existente/sin inicializar y error. Los almacenes POS opcionales `banks`, `dailyClosures`, `cashV2` y `reempaques` ausentes se informan como compatibilidad con esquemas anteriores, sin convertirlos en fallo. Una base existente sin ningún almacén se reconoce como POS sin inicializar, compatible con lectores históricos de Finanzas que podían abrir una base vacía.

La carga financiera aplica la misma lectura que espera fin de transacción a cuentas, asientos, líneas, cuentas financieras, transferencias y recibos. Los fallos de fuentes opcionales dejan evidencia; los obligatorios mantienen el rechazo de la carga, identificando el almacén. El refresco del selector de eventos utiliza los eventos ya leídos por el tablero. No se cambia la atribución de períodos, costos, comisiones, merma ni reglas de cierres.

El aviso de ausencia de registros del período se muestra solo si la lectura es completa y tampoco existen movimientos manuales, recibos o movimientos POS de efectivo filtrados. No se usa un mensaje de ausencia de datos para explicar un fallo.

## Archivos propios de E4.4

- `finanzas/script.js`: lectores estrictos del tablero, evidencia de error, aviso y recuperación. Captura adicional de la excepción síncrona al iniciar `getAll` en el lector histórico de ventas, evitando un rechazo sin manejar en las otras vistas que lo usan; conserva para ellas el resultado defensivo previo.
- `finanzas/index.html`: aviso de lectura; referencia del script r6 y registro SW r2.
- `finanzas/sw.js`: precache del script r6 y caché propia m2, sin borrar cachés anteriores.
- `assets/js/a33-build.js`: revisión propia Finanzas 2.
- `tests/a33-finanzas-e44-lecturas.smoke.cjs`: prueba VM.
- `tests/a33-finanzas-e44-lecturas.browser.smoke.cjs`: recorrido Chrome aislado.
- `tests/a33-exportaciones-e43-apertura-offline.browser.smoke.cjs`: simulación de revisión siguiente calculada desde la revisión actual, para seguir verificando espera de actualizaciones después de m2.
- `tests/catalogo.json`, `tests/README.md`, `tests/RESULTADOS_ETAPA4_4.md`: registro e informe.

Las referencias/caché propias de Finanzas se actualizan porque el recurso corregido ya se precarga desde E4.3; no es un cambio rutinario de versiones ajeno al objetivo. No se altera la versión/revisión global, el SW de Analítica ni workers de otros módulos. Los cambios de E4.1–E4.3 permanecen pendientes y no se atribuye todo el diff acumulado a E4.4.

## Pruebas y resultados

Ocho pruebas dirigidas aprobadas, sin afirmar aprobación de toda la batería:

1. E4.4 VM: fuentes vacías, base ausente y sin inicializar, esquema previo, fallos por cada almacén POS, apertura síncrona/asíncrona/bloqueada, aborto tardío, resultado inválido, avisos y recuperación. Transacciones del lector solo `readonly`; datos de entrada intactos.
2. E4.4 Chrome: ausencia de base sin creación persistente, base vacía compatible, esquema anterior de tres almacenes, fallos POS, aborto después de `getAll`, error en recibos, fallo principal de asientos y recuperación. Aviso visible y venta 100 conservada; sin errores JavaScript en la ejecución final.
3. E4.3 VM workers: recursos/precache, build, aislamiento y activación controlada.
4. E4.3 Chrome: apertura/recarga/pestaña nueva offline, exportaciones, datos y caché ajena intactos; actualizaciones pendientes y reporte de Configuración.
5. Coherencia de publicación.
6. PWA resultados/reporte de Configuración.
7. POS Vasos etapa 4, reportes/hardening.
8. E4.1 exportaciones Analítica.

Sintaxis del código y pruebas revisada; `git diff --check` sin errores. Las pruebas de E4.4 y coherencia se repitieron al ajustar el aviso de ausencia de registros.

Los primeros recorridos de E4.4 detectaron un error JavaScript al inyectar una excepción síncrona en `a33-pos.sales`: también alcanzaba al lector histórico usado por otras vistas, que no capturaba una excepción al iniciar `getAll`. Se diagnosticó su origen y se añadió esa captura en el mismo lector, sin modificar fórmulas. El recorrido final mantiene la inyección real del API, comprueba aviso estricto/recuperación y no registra errores de página. No se ocultó el error para acreditar la prueba.

No se ejecutó la batería completa ni se revalidaron los siete fallos anteriores. Las pruebas usan almacenamiento y contextos temporales, sin datos del usuario.

## Compatibilidad, límites y cierre

No se eliminan ni sobrescriben datos reales, históricos, respaldos o cachés. No se añaden dependencias. Los lectores nuevos no escriben en los almacenes y no recalculan snapshots históricos.

El aviso corresponde al tablero y su carga de fuentes; no convierte todos los lectores defensivos de otras vistas en lectores estrictos. La lectura no es una instantánea atómica entre almacenes, bases o pestañas. Un almacén opcional ausente se distingue de un error, pero no prueba por sí mismo por qué está ausente. Los importes parciales permanecen visibles con advertencia; no se restauran datos ni se reparan fuentes automáticamente.

E4.1–E4.4 siguen sin commit, push ni publicación. Se detiene para revisión manual. E4.5 no iniciada.
