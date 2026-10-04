# E5.5 — Cambios pendientes y guardado seguro de recibos

## Objetivo y alcance

Proteger el trabajo pendiente del editor de recibos de Finanzas y evitar que una versión atrasada sobrescriba un recibo guardado, emitido o anulado. Recuperar abre el formulario para revisión; no guarda, emite, anula ni crea movimientos contables.

Archivos de E5.5: finanzas/script.js, finanzas/index.html, tests/a33-finanzas-recibos-e55.smoke.cjs, tests/a33-finanzas-recibos-e55.browser.smoke.cjs, tests/catalogo.json y este informe. Se conservan los cambios anteriores de E5.1–E5.4 sin commit. No se modificaron dependencias, fórmulas, versiones, PWA, Service Workers, cachés, esquema de IndexedDB ni formatos de recibos históricos.

## Comportamiento

- Panel Cambios pendientes de recibos con consulta, Recuperar y Descartar explícitos. No se aplica ninguna copia al cargar la página. Las copias inválidas se conservan y su recuperación se bloquea.
- Clave independiente a33_fin_receipt_draft_v1_ por apertura del editor. Se conserva el identificador del recibo y la versión original sin normalizar, junto con el formulario, líneas y valores crudos de campos incompletos.
- Cada recuperación crea otra copia de trabajo y conserva la de origen hasta descarte explícito. No hay expiración ni borrado de copias anteriores. Guardar o emitir con transacción confirmada quita solamente la copia de trabajo.
- Cancelar o sustituir el editor conserva el pendiente. Si falla la copia, la última versión almacenada permanece y se advierte que los cambios más recientes siguen solo en el formulario; cerrar exige confirmar la pérdida. Hay advertencia de salida y captura best-effort al ocultar/cerrar la página.
- Una cuenta de cobro anterior ausente se muestra para revisión y debe superar las validaciones actuales. Se mantienen reglas de cuenta de cobro, moneda, tipo de cambio, clasificación, precios, descuentos, fecha sellada y totales existentes.
- Guardar, emitir y anular leen y comparan la versión completa dentro de la misma transacción readwrite de receipts. No se utiliza únicamente updatedAt. Si cambió, falta o ya fue guardado un recibo inicialmente nuevo, la operación se bloquea y se conservan los cambios pendientes.
- Se comprueba la transición de estados: guardado DRAFT, emisión DRAFT→ISSUED y anulación ISSUED→VOID. Ninguna edición atrasada puede devolver un emitido o anulado a DRAFT.
- La emisión calcula el consecutivo dentro de esa transacción, con la regla histórica max(parseInt(number))+1, incluyendo números anulados y relleno a cuatro posiciones hasta 9999. Emisiones concurrentes de recibos distintos quedan serializadas.
- La confirmación de guardado requiere transaction.oncomplete. Un aborto posterior al éxito de una solicitud no se presenta como guardado confirmado. La emisión prepara una copia y actualiza el formulario a ISSUED únicamente después de confirmar la transacción.
- Se conserva el tipo histórico de receiptId y metadata adicional que no muestra el editor. No se normaliza la versión original para comparar recibos sin marcas de tiempo.
- Reemitir conserva el original y prepara un formulario nuevo DRAFT, sin registrar ni numerar automáticamente el nuevo recibo.

## Verificación

- Prueba VM aprobada: confirmación transaccional, aborto tardío y conservación de registros, guardado atrasado, emitido no editable, registro nuevo con identificador existente, base desconocida, recibo eliminado, emisiones concurrentes, consecutivo que incluye anulados, clave histórica numérica, metadata adicional y anulación repetida bloqueada.
- VM: cambios con el mismo updatedAt se detectan; claves equivalentes ambiguas se rechazan. Un fallo de emisión mantiene el formulario DRAFT, number=null y la fecha previa.
- Smoke Chrome aprobado, con la página real, origen localhost aleatorio y contexto temporal sin Service Workers: campos incompletos, cancelar, recargar sin restauración automática, botón Recuperar, copia original conservada, recuperación sin insertar recibos, guardado y emisión reales.
- Chrome: dos pestañas sobre el mismo borrador; la primera emite y el guardado atrasado de la segunda se bloquea sin sobrescribir cliente/estado/número. Emisiones concurrentes reciben 0002 y 0003 después de 0001.
- Chrome: fallo simulado de localStorage; el aviso aparece, rechazar Cancelar mantiene el formulario abierto y reintentar permite conservar la última edición. Anular conserva el número y motivo; Reemitir prepara un nuevo DRAFT sin aumentar el conteo de recibos registrados.
- La prueba usa una cuenta de cobro posteable creada exclusivamente en su base temporal. No modifica cuentas ni datos reales.
- Regresión funcional local: 68 aprobadas, los mismos siete fallos anteriores y 19 pruebas de navegador omitidas por el ejecutor local. La nueva prueba Chrome se ejecutó por separado y aprobó; las otras 18 pruebas de navegador no se repitieron en este cierre.
- tests/runner.spec.cjs, comprobación de sintaxis y git diff --check aprobados. Diff revisado; las modificaciones de E5.5 se limitan a los archivos enumerados.

Los siete fallos conservados corresponden a agenda grouped etapa3, calculadora detalle letras/sirope, calculadora checklist etapa1, catálogos vistas independientes, lot-code etapas5/6 y POS tarjeta etapa2. No se cambiaron reglas para satisfacerlos.

## Límites y pendientes

Las copias dependen del almacenamiento de este navegador y pueden acumularse hasta descarte explícito. Si falla la copia y el navegador se cierra forzosamente, la última edición puede perderse. Los eventos de salida no garantizan persistencia. Las copias de origen permanecen después de confirmar el recibo, pero su versión original impide volver a registrarlas sobre el recibo ya cambiado.

La protección es específica de receipts y de estos flujos de Finanzas; no introduce una transacción global entre bases, localStorage u otros módulos. Las fórmulas y validaciones financieras vigentes se conservan. No se amplió la cobertura personalizada de respaldos en esta etapa.

Sin commit, push ni publicación. No se inició E5.6.
