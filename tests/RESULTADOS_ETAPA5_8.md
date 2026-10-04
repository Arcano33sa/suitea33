# E5.8 — Conflictos de edición del mismo registro

## Objetivo y autorización

Etapa autorizada mediante «procede e5.8» y elección de la recomendación: Agenda, Pedidos completos y rápidos, Lotes y clientes compartidos. Detectar modificaciones o bajas posteriores a la apertura de una edición, bloquear el guardado obsoleto y conservar el trabajo pendiente. No comprende E5.9, commit ni publicación.

## Resultado funcional

- Las ediciones ordinarias de tareas/reuniones y compras de Agenda comparan su registro original completo con el vigente. No dependen únicamente de updatedAt. Cambios de estado y bajas incluyen la versión esperada. Los conflictos conservan el formulario y las copias locales; el aviso abre el panel para quedar visible.
- Pedidos completos y rápidos conservan la versión abierta, comprueban su contenido al guardar y no recrean registros eliminados. Reabrir el registro vigente permite revisarlo antes de guardar. Las copias de formulario nuevas incorporan baseRecord, un campo opcional dentro del formato schemaVersion 1.
- Lotes comprueba la versión abierta antes de aplicar campos editables. Las bajas desde tarjeta y tabla verifican el registro vigente antes de archivarlo. Se conservan controles de producción, cantidades, códigos e identidad.
- El modal de clientes de Catálogos conserva la representación persistida que se abrió. Un cambio o una baja externa bloquea el guardado y mantiene los campos del modal.
- Los escritores compartidos de listas comparan cambios por identidad contra una base conservada en memoria. Preservan altas y cambios independientes; bloquean cambios incompatibles en la misma fila y la recreación desde copias antiguas. Se puede delimitar la intención a los identificadores editados, evitando interpretar normalizaciones de filas ajenas como modificaciones locales.
- Lectura fallida, JSON ilegible, formato no reconocido o identificadores explícitos duplicados bloquean la escritura. La comparación ordena claves de objetos para evitar conflictos por su orden, conservando el orden de arrays.
- El escritor de clientes POS conserva su base antes de la relectura interna y sus rutas de modificación comprueban el resultado del guardado antes de confirmar o sincronizar. Los antiguos modales de renombrar/fusionar no existen en el HTML vigente ni se inicializan: no se reactivaron ni se añadieron controles. La edición vigente se verifica en Catálogos.

## Compatibilidad y límites

No se modificaron fórmulas, códigos de lote, existencias, formatos históricos de respaldo ni reglas de producción. Los campos desconocidos y las filas ajenas se conservan. Las bases de comparación del servicio compartido son temporales, no nuevas claves persistidas.

Los borradores históricos de Pedidos sin baseRecord siguen siendo legibles y recuperables. Si corresponden a una edición cuya versión original no puede verificarse, se bloquea el guardado y se conserva la copia; es necesario abrir el registro vigente para revisarlo. No se trata una fecha coincidente como prueba suficiente.

Las listas históricas sin identificadores estables se comparan de forma conservadora como lista completa para permitir sus migraciones existentes. Esto puede bloquear operaciones que, con identidades estables, serían independientes.

La protección no crea exclusión mutua ni una transacción atómica entre pestañas. Persiste una ventana entre lectura, comparación y escritura ante operaciones exactamente simultáneas. Tampoco crea una transacción global entre claves, bases o metadatos; se conserva la detección de escritura parcial de E5.1. Las rutas de producción con reemplazo exacto mantienen su política previa. No se afirma protección universal de todos los escritores de la aplicación.

## Archivos de esta etapa

Aplicación:
- assets/js/a33-storage.js
- agenda/script.js
- agenda/purchases.js
- pedidos/script.js
- lotes/script.js
- catalogos/script.js
- pos/app.js

Verificación:
- tests/a33-conflictos-registros-e58.smoke.cjs (nuevo)
- tests/a33-conflictos-registros-e58.browser.smoke.cjs (nuevo)
- tests/a33-agenda-borradores-e56.smoke.cjs: expectativa actualizada para bloqueo de edición ordinaria.
- tests/a33-guardado-seguro-e51.smoke.cjs: extracción compatible con el parámetro opcional del escritor de Pedidos.
- tests/catalogo.json: registro de las dos pruebas nuevas.
- tests/RESULTADOS_ETAPA5_8.md (nuevo).

Los cambios pendientes de E5.1–E5.7 se conservaron. La revisión del diff de E5.8 y la revisión acumulada final no identificaron cambios fuera de su alcance. No se añadieron dependencias ni se modificaron HTML, PWA, service workers, cachés o versiones en E5.8. Las pruebas no utilizaron datos reales del usuario.

## Verificación

- Prueba local dirigida E5.8: **43 escenarios aprobados**, con dos escritores, conflictos de contenido aun sin cambio de fecha/revisión, reintentos, modificaciones independientes, bajas, identificadores ambiguos, datos históricos sin id, lecturas inválidas y base del escritor POS conservada antes de su relectura.
- Chrome E5.8: **aprobada** al cierre. Formularios reales de Agenda (tarea histórica y compra agrupada), Pedidos completo/rápido, Lotes y modal de clientes Catálogos. Se verificaron bloqueo sin escritura, campos conservados, reapertura y conservación de cambios independientes. Sin errores JavaScript de página.
- Chrome de recuperación Pedidos E5.3, recuperación Agenda E5.6, escritores Agenda E5.7 y navegación principal E2.4: **aprobadas** durante esta etapa.
- Regresión funcional local final: **71 aprobadas, los mismos 7 fallos anteriores y 22 pruebas de navegador omitidas por el ejecutor local**. Cinco de las 22 se ejecutaron separadamente en Chrome; las otras 17 no se repitieron.
- runner.spec.cjs: aprobado.
- Sintaxis de los siete scripts de aplicación y las dos pruebas nuevas: aprobada.
- git diff --check: aprobado.
- Informe temporal de regresión: /tmp/a33-e58-regresion-cierre-20261004.json.

Los siete fallos anteriores corresponden a Agenda agrupada Etapa 3, dos pruebas de checklist de Calculadora, vistas de Catálogos, lot-code etapas 5 y 6 y reportes de tarjeta POS Etapa 2. No se cambiaron reglas ni fórmulas para satisfacer esas expectativas previas. El ejecutor devuelve código 1 por dichos fallos; no es una regresión completamente verde.

Chrome utilizó localhost en puerto aleatorio, contexto temporal y service workers bloqueados. Una comprobación exploratoria de los modales heredados POS se descartó al confirmar que sus controles no existen en la interfaz actual; no se presenta como una prueba funcional aprobada ni se amplió la interfaz para hacerla pasar.

## Cierre

E5.8 completada localmente, detenida para revisión manual del usuario. Sin commit ni push. E5.9, verificación integrada, requiere autorización independiente.
