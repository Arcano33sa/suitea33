# Etapa E3.5 — Diagnóstico de almacenamiento

## Etapa y objetivo

Quinta de las seis etapas acordadas de protección de datos: consulta manual de solo lectura para conocer disponibilidad del almacenamiento y errores, sin limpieza, reparación, prueba de escritura ni solicitud de persistencia.

## Acuerdos funcionales

Botón Revisar almacenamiento en Configuración → Respaldo. Reutiliza el estilo y diálogo existentes. Muestra momento de consulta, lectura de localStorage, claves de la Suite y tamaño aproximado, bases IndexedDB existentes de la Suite, versiones y conteos por almacén. Muestra cuota estimada del sitio completo y persistencia concedida/no concedida cuando esas APIs están disponibles. Distingue lectura disponible, error y no comprobable. No muestra valores privados ni interpreta lectura correcta como garantía de escritura, integridad funcional o respaldo.

## Cambios y archivos

- configuracion/index.html: acceso al diagnóstico dentro de Respaldo, con componentes visuales existentes.
- configuracion/script.js: diagnóstico manual, APIs estimate/persisted de consulta, conteos con transacciones readonly, apertura sin crear/actualizar bases y cierre de conexiones. Consultas limitadas a diez segundos por operación. Si una apertura bloqueada termina después, cierra la conexión tardía.
- tests/a33-backup-e35-diagnostico.smoke.cjs y tests/a33-backup-e35-diagnostico.browser.smoke.cjs nuevos.
- tests/a33-backup-e31-exportacion.browser.smoke.cjs, tests/a33-backup-e33-importacion.browser.smoke.cjs y tests/a33-backup-e34-recuperacion.browser.smoke.cjs: espera de la base abierta, además de la función put existente, antes de preparar el fixture.
- tests/catalogo.json, tests/README.md y este informe. Cambios previos E3.1–E3.4 conservados.

## Pruebas, resultados y smoke

- Cobertura dirigida E3.1–E3.5: diez pruebas. Primera ejecución /tmp/a33-e35-dirigidas.json: ocho aprobadas y dos fallos de preparación de fixture en navegador (put disponible antes de apertura de base). Se corrigió la espera, sin modificar POS.
- Repetición /tmp/a33-e35-navegador-final.json: cinco aprobadas, incluyendo ambas fallidas, las otras pruebas de navegador afectadas y el diagnóstico VM. Las restantes pruebas dirigidas habían aprobado; no quedan fallos dirigidos pendientes.
- VM del diagnóstico ampliada con cuota inválida y fallo de persisted: aprobada. Runner y contrato de publicación aprobados. Sintaxis y diff sin errores.
- Regresión local: 58 aprobadas, mismos siete fallos anteriores y ocho navegadores omitidos en esa corrida. Los cinco navegadores de respaldos aprobaron separadamente (incluido E3.2 en la primera ejecución); los tres de otros flujos no se repitieron. /tmp/a33-e35-locales.json.
- Smoke Chrome: reporte muestra conteos reales; fallo count se identifica; compara contenido/versión de todas las bases y claves antes/después y quedan idénticos. Prueba prohíbe setItem/removeItem/put/clear durante el diagnóstico; no hay errores de página. Todo en contexto y origen localhost temporales, sin datos del usuario.
- Primer intento localhost bloqueado por sandbox (EPERM), repetición autorizada.

## Compatibilidad y protección de datos

Sin escrituras, borrados, migraciones, persistencia solicitada o almacenamiento adicional del reporte. No se modifican importación/exportación, formatos históricos, fórmulas, PWA, SW, cachés, versiones ni dependencias. El diagnóstico abre solamente bases enumeradas y aborta cualquier intento de creación/upgrade; no intenta reconstruir bases faltantes.

## Riesgos y revisión manual

Los conteos son por almacén, no una instantánea atómica de la Suite; otras pestañas pueden cambiar datos durante la consulta. El tamaño localStorage es aproximación UTF-16; cuota y uso del navegador son estimaciones de todo el origen. Persistencia concedida no sustituye un respaldo. Un resultado no comprobable no significa pérdida de datos ni fallo de la aplicación. No se prueba si futuras escrituras tendrán éxito ni se auditan relaciones internas.

Revisar manualmente el botón y legibilidad del reporte en el navegador habitual, incluyendo dispositivos móviles y un navegador con APIs limitadas cuando esté disponible. Se mantiene la interfaz existente; no hay rediseño.

## Git y continuidad

E3.1–E3.5 locales, sin commit ni push. E3.6 (fecha/tipo/antigüedad del respaldo) queda pendiente de autorización independiente.

## Resumen listo para el chat principal

E3.5 completada: diagnóstico manual de almacenamiento en Configuración → Respaldo, con lectura de claves, conteos de bases/almacenes, cuota y persistencia; distingue disponible/error/no comprobable. Solo lectura, sin limpieza ni solicitud de persistencia. Smoke Chrome confirma almacenamiento idéntico antes/después. Diez pruebas dirigidas quedan aprobadas tras corregir esperas de fixtures; regresión local 58 aprobadas y mismos siete fallos anteriores. Datos reales intactos. Sin cambios PWA/versiones/dependencias, sin commit/push. Pendiente revisión manual y autorización independiente de E3.6.
