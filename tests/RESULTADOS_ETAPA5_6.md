# E5.6 — Recuperación de formularios pendientes de Agenda

## Objetivo y alcance

Recuperar mediante elección explícita el formulario de Reunión/Tarea y la preparación de Compras de Agenda. Recuperar no registra ítems, crea clientes, mueve inventario ni ejecuta compras.

E5.6 modifica agenda/script.js, agenda/purchases.js y agenda/index.html; añade tests/a33-agenda-borradores-e56.smoke.cjs, tests/a33-agenda-borradores-e56.browser.smoke.cjs y este informe; registra ambas pruebas en tests/catalogo.json. Se conservaron los cambios previos de E5.1–E5.5 sin commit. No se modificaron dependencias, PWA, Service Workers, cachés, versiones, esquema de IndexedDB ni formatos históricos de registros y compras.

La coordinación de los dos escritores de Agenda sigue reservada a E5.7. La protección general de conflictos de ediciones normales sigue reservada a E5.8. Esta etapa comprueba la versión para aplicar y guardar una recuperación, y la existencia del identificador de un intento nuevo para impedir repetirlo secuencialmente.

## Comportamiento

- Dos paneles: Formularios pendientes de Reunión y Tarea, y Compras pendientes de guardar. Permiten consultar, Recuperar y Descartar una copia específica. No se restaura nada automáticamente al cargar la página.
- Claves independientes a33_agenda_form_draft_v1_ y a33_agenda_purchase_draft_v1_ por apertura del formulario. Pestañas diferentes no sustituyen sus copias. Recuperar crea otra copia de trabajo y conserva la fuente hasta descarte explícito. No hay caducidad ni limpieza de copias antiguas.
- Reunión/Tarea conserva tipo, identificador del intento o registro, asunto, selección y nombre del cliente, cliente nuevo todavía sin registrar, modalidad, fecha, hora, estado, prioridad, notas y el bloque opcional de Pedido con sus campos crudos y fotografía del producto/precio.
- Se reutilizan las opciones históricas de cliente/producto que ya existían. Un producto renombrado o con otro precio no sustituye automáticamente la fotografía recuperada. Las tareas históricas conservan sus datos ocultos de cliente y pedido al actualizar, según la regla existente.
- Compras conserva las líneas agrupadas con sus identificadores, nombre, categoría, unidad, precio y fotografía; fecha necesaria, prioridad, estado y notas; el artículo seleccionado todavía no agregado y su cantidad cruda; y la edición activa de una cantidad de línea, incluso vacía.
- Las líneas ya agregadas mantienen sus fotografías históricas aunque el artículo esté inactivo o cambie su precio. La selección pendiente mantiene el precio capturado; cambiarla explícitamente utiliza el catálogo actual. Un artículo pendiente ausente no puede agregarse hasta revisar la selección. Se reutilizan las validaciones existentes de cantidades y unidades.
- Guardar una compra con una cantidad en edición primero exige validar y aplicar esa cantidad mediante el mecanismo existente. Si está incompleta, el formulario y la copia permanecen. Se mantienen las fórmulas de subtotal y total y el formato purchaseGroup/purchase histórico.
- Nuevo, abrir otro registro o volver al inicio conserva el formulario anterior como copia pendiente. Si falla la copia, se advierte que la última edición sigue en memoria; rechazar la confirmación de pérdida mantiene el formulario abierto. La última copia válida permanece intacta.
- Hay captura de cambios, advertencia de salida y guardado best-effort al ocultar/cerrar la página. Compras bloquea interacción durante la carga; sus botones mantienen el bloqueo de guardado hasta terminar la operación.
- La copia guarda la versión cruda correspondiente al registro mostrado, antes de normalizarlo. No adopta como base una versión posterior de otra pestaña. Antes de recuperar se comprueba esa versión; después de una carga asíncrona y antes de guardar un recuperado se vuelve a comprobar. Un registro cambiado, ausente, ambiguo o un intento nuevo ya registrado se avisa y se conserva sin aplicarlo sobre la versión vigente.
- Si el registro cambia durante la recuperación, el guardado queda bloqueado y se conservan tanto la fuente como el formulario pendiente para revisión. Una recuperación válida posterior permite continuar.
- Los intentos nuevos mantienen el mismo identificador durante un fallo de guardado y su reintento. Un guardado confirmado elimina solamente la copia de trabajo; la de origen conserva su identificador, por lo que no puede registrarse otra vez como nueva.
- Copias de estructura desconocida se conservan, con recuperación deshabilitada. Descartar requiere confirmación y elimina únicamente la copia elegida, sin alterar registros guardados ni otras copias.

## Verificación

- Prueba VM dirigida aprobada: campos incompletos, estructura incompatible, copia por apertura, identidad del intento, fuente intacta y recuperación sin tocar registros; fallo de escritura conserva la copia anterior y rechazar la salida mantiene el formulario; registro guardado, cambiado o ausente y lectura fallida se bloquean; carga/guardado en curso impiden recuperar; confirmación limpia solamente la copia de trabajo y descarte afecta solo la copia elegida.
- VM: listas históricas sin marcas de tiempo compatibles; versión explícita del formulario preservada frente a una versión más reciente; cambio durante la recuperación mantiene bloqueo y aviso, permite copiar cambios adicionales y admite una recuperación válida posterior.
- Smoke Chrome aprobado en la página real, origen localhost aleatorio y contexto temporal con Service Workers bloqueados. Verifica Reunión, Tarea y Compras desde la navegación vigente del encabezado y los botones Recuperar.
- Chrome: recargar deja el inicio visible sin restaurar automáticamente. Recuperar conserva cliente nuevo aún no registrado, modalidad, hora, Pedido y cantidad incompleta; comparar registros y catálogo de clientes demuestra que la recuperación no los modificó. Cambiar nombre/precio del producto del catálogo no sustituye el precio capturado de 100. El guardado posterior conserva ID y total de 200.
- Chrome: falla el guardado del registro de una tarea; conserva campos y copia, y el reintento produce un solo registro con el identificador original. Una tarea histórica recuperada conserva cliente y pedido ocultos.
- Chrome: compra con artículo agregado, otro todavía sin agregar y cantidad de línea en edición vacía. Recuperar conserva esa cantidad y las fotografías frente a artículo inactivo y precios nuevos. Guardar incompleto se bloquea; al completar las cantidades se mantienen precios 20/30 y total 90. Un fallo simulado de escritura de la compra conserva la preparación y el reintento registra un solo grupo con el ID original.
- Chrome: segunda pestaña crea una copia distinta; registro editado externamente con la misma fecha se detecta antes de guardar el recuperado; fallo de copia local conserva el texto en memoria y la copia anterior, y rechazar la salida mantiene el formulario. El inventario temporal permanece exactamente igual al inicial.
- Smoke existente de compras agrupadas etapa1 y su hardening aprobados, incluidos en la regresión.
- Regresión funcional local final: 69 aprobadas, los mismos siete fallos anteriores y 20 pruebas de navegador omitidas por el ejecutor local. La nueva prueba Chrome se ejecutó por separado y aprobó; las otras 19 no se repitieron en este cierre.
- tests/runner.spec.cjs, sintaxis de ambos scripts y git diff --check aprobados. Diff revisado; las modificaciones de E5.6 se limitan a los archivos enumerados.
- Todas las escrituras de pruebas usaron almacenamiento temporal aislado. No se usaron datos reales.

Los siete fallos conservados corresponden a Agenda compras agrupadas etapa3, calculadora detalle letras/sirope, calculadora checklist etapa1, catálogos vistas independientes, lot-code etapas5/6 y POS tarjeta etapa2. No se cambiaron reglas para satisfacerlos.

## Límites y pendientes

Las copias dependen de este navegador y pueden acumularse hasta descarte explícito. La última edición puede perderse tras un cierre forzado si no pudo persistirse; los eventos de salida no garantizan escritura. Las copias conflictivas permanecen sin aplicarse: se debe revisar el registro vigente.

La comparación en localStorage no es una transacción ni un bloqueo entre pestañas. Los escritores actuales siguen guardando la lista con sus mecanismos existentes; esta etapa no garantiza coordinación global, fusión de ediciones normales ni exclusión mutua. E5.7/E5.8 deben atender esos alcances por separado. No se amplió la cobertura personalizada de respaldos ni se verificó PWA/caché en esta etapa.

Sin commit, push ni publicación. No se inició E5.7.
