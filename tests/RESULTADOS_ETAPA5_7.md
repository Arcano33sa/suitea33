# E5.7 — Coordinación de escritores de Agenda

## Objetivo y alcance

Coordinación de los escritores de reuniones/tareas (`agenda/script.js`) y compras (`agenda/purchases.js`) sobre `a33_agenda_records_v1`. Etapa autorizada mediante «procede e5.7». No incluye E5.8 (resolución general de ediciones concurrentes del mismo registro), E5.9, commit ni publicación.

## Hallazgo comprobado

El escritor principal guardaba su lista completa en memoria, normalizando incluso compras ajenas. Una compra creada después de cargar esa lista podía desaparecer al guardar una tarea. Compras leía una lista más reciente, pero mantenía una implementación de escritura separada. El escritor principal tampoco notificaba a Compras ni escuchaba cambios de almacenamiento entre pestañas.

## Cambios

- Una rutina compartida en `agenda/purchases.js` aplica altas, actualizaciones, cambios de estado y bajas a la lista vigente. Ambas rutas la utilizan.
- Solo modifica el registro señalado. Conserva registros ajenos sin normalizarlos, campos desconocidos del registro actualizado y metadatos del contenedor. Mantiene lectura de arrays históricos y contenedores con `records`; guarda un contenedor compatible.
- Las lecturas fallidas, JSON ilegible y estructuras no reconocidas bloquean la escritura. No se interpretan como una lista vacía al guardar.
- Bloquea altas con identificador existente, operaciones sobre identificadores ambiguos y actualizaciones de filas ausentes. Una edición cuyo registro fue eliminado permanece pendiente, sin recrearlo.
- El escritor principal aplica el resultado confirmado a su estado; no adelanta su lista en memoria antes de confirmar la escritura. Conserva las bases utilizadas por la recuperación E5.6.
- Los dos escritores notifican cambios después de la escritura confirmada. El principal escucha cambios entre pestañas y actualiza la lista sin sustituir el contenido del formulario abierto. Se evitan notificaciones duplicadas del propio escritor.
- Los cambios de estado aplican solo estado y fecha a la fila vigente.

## Archivos de esta etapa

- `agenda/script.js`
- `agenda/purchases.js`
- `tests/catalogo.json`
- `tests/a33-agenda-escritores-e57.smoke.cjs` (nuevo)
- `tests/a33-agenda-escritores-e57.browser.smoke.cjs` (nuevo)
- `tests/RESULTADOS_ETAPA5_7.md` (nuevo)

Se revisó el diff contra copias temporales anteriores a E5.7. Los cambios pendientes de E5.1–E5.6 se conservaron. No se modificaron interfaz, HTML, fórmulas, existencias, dependencias, PWA, service workers, cachés ni versiones en esta etapa.

## Verificación final

- VM E5.7: aprobada. Altas y cambios independientes, campos históricos y metadatos, bajas sin resurrección, arrays históricos, identificadores duplicados, fallos de lectura/escritura y ausencia de confirmación falsa.
- Chrome E5.7: aprobada. Formularios reales de tarea y compra en dos pestañas; editor conservado ante actualización externa; guardado desde lista obsoleta; registro ajeno eliminado sin resurrección; registro abierto eliminado desde otra pestaña sin recreación; histórico intacto y notificación única.
- Chrome E5.6: repetida tras los ajustes finales y aprobada. Recuperación, precios históricos, cantidades incompletas, reintentos, fuentes y datos de dominio conservados.
- Smoke de compras agrupadas Etapa 1 y hardening: aprobadas.
- Regresión funcional local final: **70 aprobadas y los mismos 7 fallos anteriores**, 21 pruebas de navegador omitidas por el ejecutor local. Dos de esas pruebas se ejecutaron separadamente en Chrome (E5.6 y E5.7); las otras 19 no se repitieron.
- `tests/runner.spec.cjs`, sintaxis de ambos scripts y `git diff --check`: aprobados.
- Informe temporal de regresión: `/tmp/a33-e57-regresion-final-20261003.json`.

Los siete fallos previos siguen en Agenda agrupada Etapa 3, dos pruebas de checklist de Calculadora, vistas de Catálogos, lot-code etapas 5 y 6 y reportes de tarjeta POS Etapa 2. No se cambiaron reglas ni marcadores para satisfacer esas expectativas anteriores.

Todas las pruebas de navegador utilizaron servidor localhost de puerto aleatorio, contexto temporal y service workers bloqueados. No utilizaron almacenamiento real del usuario.

## Límites y pendiente

La operación lee y escribe síncronamente sin esperas intermedias en una misma pestaña. Evita sobrescribir listas obsoletas, pero **no crea una transacción atómica entre pestañas**: dos operaciones que se solapen exactamente entre lectura y escritura aún podrían perder un cambio. La prueba entre pestañas verifica operaciones consecutivas con editores abiertos; no demuestra exclusión mutua.

La resolución de dos ediciones ordinarias sobre el mismo registro continúa pendiente para E5.8; el último guardado puede sustituir campos del registro editado. Se mantienen las comprobaciones específicas de recuperación E5.6. Los lectores de presentación conservan su comportamiento previo ante datos ilegibles; el guardado es quien bloquea cualquier reemplazo.

Etapa terminada localmente y detenida para revisión. Sin commit ni push. E5.8 y E5.9 no iniciadas.
