# E3.1 — Exportaciones con lecturas completas

Primera de seis etapas acordadas para Protección de datos. Objetivo autorizado: impedir que una lectura fallida produzca una copia presentada como respaldo completo, e identificar el origen del fallo. No se permite descargar como completa una copia incompleta.

## Acuerdos y cambios

- Enumeración IndexedDB obligatoria: si falla, devuelve una respuesta inválida o no está disponible, se informa el error y no se genera el respaldo. Una lista vacía válida se distingue de una consulta fallida.
- Los errores de bases de datos y localStorage se acumulan; `buildFullBackup` termina con `A33_BACKUP_READ_INCOMPLETE` antes de construir el JSON cuando hay lecturas fallidas.
- Las lecturas de esquema y datos de un almacén identifican base y almacén; se espera la confirmación de la transacción readonly y se cierra la conexión también al fallar.
- localStorage se lee directamente durante exportación para distinguir errores de acceso de datos ausentes. Se mantienen prefijos admitidos y exclusión de claves retiradas. Se bloquea una clave incluida que desaparezca durante la lectura.
- Se reutiliza el modal de error existente, sin botón de descarga de respaldo incompleto ni rediseño.
- La exportación personalizada usa la misma lectura completa: también se bloquea si falla esa lectura, aunque el fallo esté fuera de la selección. Es una protección conservadora; esta etapa no añade una copia incompleta ni modifica la cobertura personalizada.

## Archivos modificados

- `configuracion/script.js`: enumeración, snapshot IndexedDB, lectura localStorage y validación de integridad antes de construir el respaldo.
- `tests/a33-backup-e31-lecturas-completas.smoke.cjs` (nuevo): escenarios VM con funciones reales de Configuración.
- `tests/a33-backup-e31-exportacion.browser.smoke.cjs` (nuevo): descarga válida y errores en Chrome con datos temporales.
- `tests/catalogo.json`: dos altas con resultados de E3.1.
- `tests/README.md`: comandos y alcance.
- `tests/RESULTADOS_ETAPA3_1.md` (nuevo): este informe.

No hay archivos modificados fuera de ese alcance.

## Pruebas y smoke

- Dirigidas finales: **2 aprobadas**. Informe temporal `/tmp/a33-e31-final-dirigidas.json`.
- VM: respaldo completo válido y esquema histórico 8; personalizado válido con código histórico literal; ausencia real de bases; fallos de lista, API ausente, bases, localStorage bloqueado o clave no disponible; bloqueo del botón completo y del constructor personalizado; cierre de conexión en éxito/fallo; solicitud fallida y transacción abortada después de una lectura exitosa.
- Chrome: descarga JSON completo válido con producto y código histórico; errores de enumeración, lectura de products y lectura localStorage identificados y sin descarga. Sin errores JS capturados ni importaciones. Datos aislados en origen localhost aleatorio y contexto nuevo.
- Regresión local: **54 aprobadas, 7 fallidas preexistentes, 4 entradas de navegador omitidas en esa ejecución local**. Informe `/tmp/a33-e31-locales.json`. Una de esas cuatro (E3.1) se ejecutó y aprobó por separado; las tres de E2.4 no se repitieron.
- Pruebas del ejecutor y contrapruebas de publicación: aprobadas.
- Sintaxis de Configuración y archivos CJS: aprobada.
- Diff revisado; `git diff --check` sin errores. No se alteraron las siete comprobaciones históricas/textuales pendientes de Etapa 2.

El primer smoke Chrome quedó bloqueado por permiso localhost del sandbox; se repitió con autorización del entorno y aprobó. No se presenta el bloqueo inicial como fallo de aplicación.

## Compatibilidad y protección

El JSON válido mantiene formatos, schemaVersion, metadatos, códigos históricos literales, registros y selección personalizada existentes. Importación y reglas de fusión intactas. La exportación no escribe, elimina, normaliza ni reemplaza datos persistentes del usuario. Los datos usados en pruebas son temporales/simulados.

No se añadieron dependencias ni se cambiaron HTML, interfaz, versiones, Service Workers o precaches. La lectura estricta usa el localStorage del mismo origen que A33Storage, conservando sus filtros de respaldo.

## Límites y revisión manual

Navegadores sin `indexedDB.databases()` ahora bloquean exportación en vez de suponer una lista completa. La exportación personalizada también requiere poder leer el conjunto base. Estos límites se informan al usuario; no afectan la lectura de archivos históricos por importación.

E3.1 verifica lecturas fallidas, no garantiza una instantánea atómica frente a escrituras simultáneas de otras pestañas. No comprueba que el usuario conserve el archivo descargado. No corrige validación, errores de escritura, reemplazo de bloques ausentes ni recuperación de importaciones: pertenecen a las siguientes etapas.

Revisión manual pendiente: cargar el código local actual, exportar completo y personalizado, comprobar el resumen y guardar la copia en una ubicación elegida. No importar sobre datos reales como parte de esta revisión. Las pruebas Chrome sirvieron archivos con no-store.

## Git y cierre

Cambios locales únicamente en los seis archivos descritos. Sin commit ni push; se detiene para revisión del usuario. E3.2 necesita autorización independiente.

## Resumen para copiar al chat principal

E3.1 completada: exportación bloqueada si falla enumeración IndexedDB, lectura de base/almacén o localStorage; mensaje identifica el origen y no ofrece descarga completa. Se conserva formato histórico y se cierran conexiones incluso al fallar. La protección también alcanza personalizado por su lectura base compartida. Dos pruebas dirigidas (VM/Chrome) aprobadas; regresión local 54 aprobadas y siete fallos ya documentados. Runner, contrapruebas, sintaxis y diff verificados. Datos, importación, reglas, interfaz, PWA y versiones intactos; sin dependencias, commit ni push. Pendiente revisión manual; se detiene sin iniciar E3.2.
