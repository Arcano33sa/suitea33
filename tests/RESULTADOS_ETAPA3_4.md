# Etapa E3.4 — Errores de importación y respaldo previo

## Etapa, objetivo y acuerdos

Cuarta de seis etapas acordadas de protección de datos. Detectar fallos de escritura sin informar una importación incompleta como exitosa y disponer de una copia completa previa para recuperación manual. Reemplazo por bloques presentes y fusión parcial continúan; no se introduce restauración automática, transacción global ni borrado de datos ausentes.

## Cambios y archivos

- configuracion/script.js: reemplazo IndexedDB registra la finalización de la transacción antes de escribir; clear/put síncronos y errores asíncronos detienen el proceso con contexto base/almacén. Intenta abortar el almacén afectado y siempre cierra su conexión.
- Fusión no omite silenciosamente almacenes ausentes, registros sin identidad escribible o errores de put. Lecturas previas de identidad/duplicados dejan de esconder errores. Conserva las reglas de identidad de productos, lotes y duplicados.
- Importación verifica el resultado de A33Storage.setItem y relee el valor escrito. Lecturas previas usan localStorage sin ocultar errores. Una fusión fallida detiene el proceso; no recurre a sobrescribir el valor original después de un fallo.
- Tras confirmar el archivo, se prepara un respaldo completo antes de cualquier escritura. Si esa lectura falla, se bloquea la importación. Se solicita descargarlo y después verificar su guardado/cerrar otras pestañas antes de continuar. Cancelar esos pasos no aplica la importación.
- Si falla la aplicación, se muestra Error de importación, la ubicación y una advertencia de posibles bloques ya aplicados; se ofrece descargar otra vez la misma copia previa y no se registra éxito de importación.
- tests/a33-backup-e34-fallos-escritura.smoke.cjs y tests/a33-backup-e34-recuperacion.browser.smoke.cjs nuevos; tests/a33-backup-e33-importacion.browser.smoke.cjs adaptado al paso previo. tests/catalogo.json, tests/README.md y este informe. Se conservan los cambios locales E3.1–E3.3.

## Pruebas y resultados

- Ocho pruebas dirigidas de E3.1–E3.4 APROBADAS, incluidas cuatro en navegador: /tmp/a33-e34-dirigidas.json.
- Smoke E3.4 ampliado posteriormente para localStorage rechazado en importación parcial: APROBADO. Un intento encontró colisión del ID de prueba con el evento inicial de POS; se cambió el ID del registro entrante, sin cambio de lógica de aplicación, y se repitió exitosamente.
- Regresión local: 57 APROBADAS, mismos siete fallos documentados en E2/E3.1–E3.3 y siete navegadores no ejecutados en esa corrida. Los cuatro de respaldo pasaron separadamente; tres anteriores de otros flujos no se repitieron. /tmp/a33-e34-locales.json.
- Verificaciones del runner, contrato de publicación, sintaxis y diff. El entorno bloqueó inicialmente localhost (EPERM); ejecución de Chrome repetida con autorización.
- Todas las pruebas de importación usan contexto/origen temporales. El smoke verifica que put fallido aborta el vaciado del almacén y preserva registros previos; una falla local tardía muestra error y permite volver a descargar el respaldo previo aunque ya haya operaciones anteriores aplicadas.

## Compatibilidad y protección

Formatos full 8/partial 7 y códigos históricos sin cambios. Datos reales, archivos históricos y respaldos existentes intactos. Sin dependencias nuevas ni cambios visuales, PWA, SW o versiones. Los registros que no se pueden fusionar por falta de identidad ahora producen error en vez de contabilizarse como omisión silenciosa.

## Riesgos y revisión manual

La importación sigue siendo por almacenes; un fallo tardío puede dejar bloques anteriores aplicados. El aborto protege la transacción afectada, no las ya confirmadas. La copia previa no es una instantánea atómica entre bases/pestañas. Se solicita cerrar las demás pestañas; no hay bloqueo global. La aplicación puede iniciar una descarga, pero no confirmar el guardado en disco: el usuario lo verifica antes de continuar.

La copia de recuperación se conserva en memoria mientras está abierto el diálogo y en el archivo descargado. Cerrar/recargar pierde esa copia en memoria; debe conservarse el archivo. No se añade almacenamiento permanente extra ni se realiza una restauración automática. Recuperación manual mediante el flujo de importación existente, con revisión previa del archivo y del estado actual, solo cuando se autorice esa operación.

Revisión manual pendiente: mensajes y cancelación de los pasos de respaldo previo, descarga y confirmación; cualquier ensayo de restauración debe realizarse con datos aislados. La prueba de navegador no acredita recuperación de todos los módulos ni guardado final en disco.

## Git y continuidad

E3.1–E3.4 locales, sin commit ni push. No se avanza a E3.5 (diagnóstico) o E3.6 (antigüedad) sin autorización independiente.

## Resumen listo para el chat principal

E3.4 completada: errores de escritura/lectura de importación se detectan y contextualizan; transacción afectada se aborta cuando es posible; no se muestra éxito ante fallo. Respaldo completo previo obligatorio, descarga y confirmación de guardado antes de importar, y nueva descarga de la misma copia en caso de error. Recuperación manual, sin restauración automática. Ocho pruebas dirigidas aprobadas y smoke ampliado de fallo tardío aprobado. Regresión local: 57 aprobadas, mismos siete fallos previos. Datos reales intactos, formatos históricos conservados, sin cambios PWA ni dependencias. Sin commit/push. Pendiente revisión manual del usuario.
