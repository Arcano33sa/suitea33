# Etapa E3.3 — Validación previa y conservación de datos ausentes

## Objetivo y acuerdos funcionales

Tercera de las seis etapas acordadas de protección de datos. Bloquear estructuras malformadas antes de aplicar una importación y conservar los bloques ausentes, incluida Materia Prima en archivos históricos. Mantener reemplazo de bloques presentes para completos y fusión para parciales. Una lista vacía explícita sigue siendo un bloque presente; no se convierte ausencia en vacío.

## Cambios y archivos

- configuracion/script.js: valida objetos raíz/meta/data/mapas, almacenes como listas de objetos, versiones positivas y metadatos de esquema opcionales. Valida valores de almacenamiento serializados, preservando contratos especiales de Costos, Agenda y Pedidos rápidos. Pedidos rápidos con JSON corrupto o registros inválidos se rechazan en lugar de normalizarse silenciosamente a vacío.
- La validación se ejecuta en la carga UI y en las entradas de importación, antes de sanitizar o preparar productos. Los errores identifican base, almacén, registro o clave.
- Se elimina la ruta que vaciaba rawMaterials cuando el archivo no lo incluía. El indicador de resultado rawMaterialsDefaulted se conserva como false por compatibilidad.
- Nuevos tests/a33-backup-e33-validacion.smoke.cjs y tests/a33-backup-e33-importacion.browser.smoke.cjs; actualizados tests/catalogo.json y tests/README.md; este informe.

## Pruebas y smoke

- Seis pruebas dirigidas E3.1/E3.2/E3.3 aprobadas, incluidas tres pruebas de navegador. Reporte /tmp/a33-e33-dirigidas.json.
- Regresión local: 56 aprobadas, los mismos siete fallos anteriores y seis pruebas de navegador no ejecutadas en esa corrida. Las tres de respaldos aprobaron separadamente; las tres anteriores de otros flujos no se repitieron. Reporte /tmp/a33-e33-locales.json.
- Smoke real: archivo con events como objeto bloqueado; archivo histórico completo sin schemas/versiones importa Events y conserva Materia Prima, Productos y clave local no incluidos. Chrome temporal, origen localhost aleatorio, sin Service Workers ni datos del usuario.
- El primer intento de navegador fue bloqueado por sandbox al abrir localhost (EPERM); la repetición autorizada pasó.
- Sintaxis, pruebas del runner/contrato de publicación y diff revisados. Modificación de aplicación limitada a validación y eliminación del vaciado por ausencia.

## Compatibilidad y protección de datos

Se conservan esquemas de archivo 7/8, app/appName, archivos históricos sin metadatos de esquema y códigos de lotes literales. No se modifican formatos ni fórmulas. Los valores ordinarios de localStorage deben ser texto como en las exportaciones nativas; formatos especiales reconocidos siguen admitiendo su representación estructurada. Archivos malformados previamente tolerados ahora se rechazan con explicación. No se borraron ni sobrescribieron datos reales, históricos o respaldos.

## Riesgos y revisión manual pendiente

Validación estructural no equivale a verificación de todas las reglas de negocio, identidades y referencias ni garantiza éxito de cada escritura. Siguen pendientes E3.4 (errores de escritura y recuperación), E3.5 (diagnóstico) y E3.6 (antigüedad de respaldo). No hay transacción global entre bases y localStorage. Los bloques retirados o ajenos mantienen sus filtros existentes. Revisar mensajes y resumen en navegador habitual; cualquier prueba de restauración debe hacerse con datos aislados y autorización específica, sin sobrescribir datos operativos.

## Git y continuidad

E3.1/E3.2 permanecen sin commit junto a E3.3. No hubo commit ni push, cambios PWA/SW/versiones, dependencias ni avance automático a E3.4.

## Resumen listo para el chat principal

E3.3 completada: validación estructural previa a cualquier importación y conservación de bloques ausentes. Corregido el vaciado de Materia Prima al importar respaldos históricos que no la contienen. Se mantienen formatos históricos, reemplazo de bloques presentes y fusión parcial. Seis pruebas dirigidas aprobadas, incluidas exportaciones e importación real en Chrome aislado. Regresión local: 56 aprobadas y mismos siete fallos anteriores, sin nuevos fallos. Datos reales intactos. Sin commit/push ni cambios PWA. Pendiente revisión del usuario y autorización independiente de E3.4.
