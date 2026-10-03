# Etapa E3.6 — Fecha, tipo y antigüedad del respaldo

## Etapa y objetivo

Sexta y última de las seis etapas acordadas de protección de datos. Mostrar en Configuración → Respaldo la fecha, tipo y antigüedad del último respaldo cuya descarga se solicitó, sin atribuir a la aplicación confirmación de guardado final en disco.

## Acuerdos funcionales

- Preparar o cancelar una exportación no actualiza el registro. La actualización ocurre después de solicitar la descarga.
- Tipos diferenciados: completo, personalizado parcial y completo previo a importación. No se presenta un parcial como copia completa.
- Se muestran fecha de preparación del contenido, antigüedad de ese contenido, fecha de solicitud de descarga y nombre del archivo. Descargar nuevamente una copia previa conserva su fecha de preparación; la edad no se reinicia.
- Sin registro histórico no se inventa una fecha. Registro inválido/inaccesible se muestra como no comprobable. Una fecha futura advierte revisar el reloj.
- Si guardar el seguimiento falla, la descarga solicitada continúa y se muestra el registro de sesión con advertencia; no se reemplaza un registro anterior en disco ni se oculta el fallo.
- Seguimiento propio del navegador: nueva clave suite_a33_backup_last_export_v1. No forma parte de los respaldos transferibles ni se importa de otro archivo. No se modifica ni elimina almacenamiento previo para aplicar esa exclusión.

## Cambios y archivos

- configuracion/index.html: información de última descarga solicitada dentro del apartado Respaldo, usando estructura/estilo existentes.
- configuracion/script.js: registro y presentación, integración en descargas completas/parciales/previas, separación entre preparación y solicitud, actualización al abrir Respaldo/volver a la página y eventos de almacenamiento entre pestañas. Mensajes de descarga aclaran que se solicitó y debe comprobarse su guardado.
- tests/a33-backup-e36-antiguedad.smoke.cjs y tests/a33-backup-e36-antiguedad.browser.smoke.cjs nuevos.
- tests/catalogo.json, tests/README.md y este informe. Cambios locales E3.1–E3.5 conservados.

## Pruebas y resultados

- Doce pruebas dirigidas E3.1–E3.6 aprobadas, incluidas seis pruebas Chrome: /tmp/a33-e36-dirigidas.json.
- Smoke E3.6: preparar/cancelar no persiste fecha; descarga real completa/parcial registra tipo/archivo; recarga conserva seguimiento; cambios desde otra pestaña y registro corrupto se reflejan. Contexto/origen temporales, sin datos reales ni errores de página.
- VM verifica edad del contenido, fecha futura/ilegible, repetición de respaldo previo, solicitud fallida sin cambio de registro, fallo al guardar seguimiento y exclusión de la clave en exportación/importación.
- Regresión local: 59 aprobadas, mismos siete fallos anteriores y nueve pruebas de navegador omitidas en esa corrida. Las seis de protección de datos se ejecutaron y aprobaron separadamente; tres anteriores de otros flujos no se repitieron. /tmp/a33-e36-locales.json.
- Runner, contrato de publicación, sintaxis y diff aprobados/revisados. Primer intento localhost bloqueado (EPERM); ejecución de Chrome autorizada posteriormente.

## Compatibilidad y protección de datos

Formatos de respaldo completos/parciales y datos históricos sin cambios. La nueva clave contiene exclusivamente metadatos de seguimiento, no información operacional. No se borraron ni sobrescribieron datos reales, respaldos ni históricos. Sin nuevas dependencias, fórmulas, rediseños, modificaciones PWA/SW/cachés/versiones ni publicación.

## Riesgos y revisión manual pendiente

El registro indica una solicitud de descarga, no guardado en disco, integridad del archivo descargado ni cobertura total cuando es parcial. La edad depende del reloj del dispositivo y se actualiza al renderizar el apartado, volver a la página o recibir un cambio entre pestañas; no hay temporizador de actualización permanente. El registro puede perderse si el navegador elimina almacenamiento; se informa ausencia en vez de asumir que nunca existió un respaldo. Revisar manualmente la presentación en navegador habitual y móvil, así como el archivo guardado.

## Git y cierre del bloque

Implementación de E3.1–E3.6 completada localmente. Sin commit ni push. Queda pendiente revisión/aprobación del usuario y autorización independiente de commit/publicación. No se inicia otro bloque operativo.

## Resumen listo para el chat principal

E3.6 completada: Configuración muestra tipo, fecha del contenido, antigüedad, solicitud de descarga y archivo; distingue completo/parcial/copia previa. Solo registra descargas solicitadas, no preparación o cancelación; guardado final requiere comprobación del usuario. Seguimiento local no transferible y aviso ante fallo de persistencia. Doce pruebas dirigidas aprobadas, con seis smoke Chrome. Regresión local: 59 aprobadas y mismos siete fallos anteriores, sin nuevos fallos. Las seis etapas de protección de datos quedan implementadas localmente. Datos reales intactos; sin cambios PWA/versiones/dependencias ni commit/push. Pendiente revisión del usuario.
