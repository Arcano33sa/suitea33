# E5.4 — Recuperación de compras provisionales POS

## Objetivo y alcance

Conservar la compra provisional y recuperarla mediante elección explícita, preservando purchaseUid y pasando por las validaciones actuales antes de guardar. Recuperar nunca crea una venta, cobra, mueve inventario ni reserva existencias.

E5.4 modifica pos/app.js y pos/index.html, agrega dos pruebas y este informe, y registra las pruebas en tests/catalogo.json. Se conservaron los cambios previos de E5.1–E5.3, todavía sin commit. No se modificaron formatos de sales, fórmulas, dependencias, PWA, Service Workers, cachés ni versiones.

## Comportamiento

- Panel Compras provisionales con consulta de copias, Recuperar y Descartar. Al cargar la página no se aplica ninguna copia automáticamente.
- Clave independiente a33_pos_purchase_draft_v1_ por apertura. Cada recuperación crea una copia de trabajo nueva y conserva la de origen hasta descarte explícito. No hay expiración ni limpieza automática de copias antiguas.
- Captura identidad del intento, evento, fecha, cliente, productos y extras, cantidades/precios/descuentos crudos, cortesías/devolución, método y banco de pago, notas, forma de cobro en efectivo y USD recibido. No persiste referencias DOM, bloqueos, catálogo completo ni stock que deba considerarse vigente.
- Agregar/quitar líneas, elegir/limpiar cliente y editar campos actualiza la copia. Cerrar o cancelar conserva el provisional, sin registrar nada, y restaura el cliente previo como antes. Si guardar la copia falla, queda el formulario y la última copia válida; cerrar exige confirmación explícita de pérdida de los cambios más recientes.
- Recuperar exige seleccionar el evento y fecha originales, con evento/día abiertos. Intentos ya presentes en sales se rechazan para impedir repetición de la compra. No se cambian automáticamente la selección compartida del evento ni los bloqueos de día.
- La recuperación usa catálogo vigente y conserva el precio editable del producto. Un producto/extra no disponible o un precio cambiado de extra se avisa y bloquea al guardar hasta revisar/quitar/reagregar esa línea. Un banco ausente exige elegir uno vigente. Para USD se mantiene la regla existente de T/C central vigente y se avisa si cambió respecto de la copia.
- Guardar un recuperado relee contexto y catálogo y utiliza savePurchasePOS y su transacción existente. Se conservan validaciones de stock, lotes, bancos, cobro, cortesías y devoluciones, así como protección de duplicados y efectos posteriores.
- La confirmación histórica por stock insuficiente de productos sigue intacta: permite continuar si el usuario confirma; rechazar conserva la compra sin ventas. Los extras mantienen sus propias validaciones de stock.
- Después del guardado confirmado se limpia solamente la copia de trabajo. Un fallo al quitarla se avisa como compra ya registrada y no se presenta como fallo del cobro. Las copias de origen siguen disponibles, pero su purchaseUid ya registrado impide recuperarlas como una compra nueva.
- Hay bloqueo de apertura/recuperación concurrente, estado busy durante preparación de la recuperación y eventos de captura/advertencia de salida. Los formatos incompatibles se conservan sin aplicar.

## Verificación

- Prueba VM dirigida aprobada: formato, campos incompletos, identidad, rechazo de duplicados/formato incompatible, almacenamiento que devuelve false, última copia válida conservada, no capturar un confirmado, evento/fecha cambiados, día cerrado, intento registrado, producto ausente, precio cambiado de extra y cierre de compra confirmada aunque quitar su copia arroje una excepción.
- Chrome E5.4 aprobado en origen localhost aleatorio y contexto temporal: abrir, editar, cancelar, recargar sin aplicar automáticamente, botón Recuperar, conservación de campos/UID/cliente/USD y copia de trabajo independiente. Comparación exacta de sales, inventory y events demuestra que recuperar no alteró esas fuentes.
- Chrome: stock vigente provoca la confirmación histórica; rechazarla deja el modal y no inserta ventas. Al reponer el stock de prueba, el guardado posterior confirma las dos líneas con UID original, limpia la copia de trabajo y bloquea una nueva recuperación de la copia de origen registrada.
- Chrome: segunda pestaña tiene otra clave. Ante fallo simulado de escritura se conserva la copia anterior y el texto vigente; rechazar el cierre mantiene el modal. Reintentar guarda y permite cerrar conservando el provisional.
- Smoke Chrome del flujo normal de compras multiproducto aprobado (prueba existente etapa2), además de la nueva prueba E5.4.
- Regresión funcional local: 67 aprobadas, los mismos siete fallos anteriores y 18 pruebas de navegador omitidas por el ejecutor local. Se ejecutaron por separado dos pruebas Chrome y aprobaron; las otras 16 no se repitieron.
- Comprobación de sintaxis de pos/app.js, tests/runner.spec.cjs y git diff --check aprobadas. Diff revisado; sin cambios de áreas ajenas a la compra provisional durante E5.4.
- Todas las escrituras de las pruebas fueron en almacenamiento temporal aislado; no se usaron datos reales.

## Límites y pendientes

Las copias dependen del almacenamiento de este navegador y pueden acumularse hasta descarte explícito. Un fallo de persistencia no garantiza recuperar la última edición después de un cierre forzado. Los eventos de salida son best-effort. Un provisional no es una reserva ni fija disponibilidad o T/C futuro. La transacción existente protege el registro de la compra, pero no hay una transacción global para todos los efectos posteriores entre módulos.

No se amplió cobertura personalizada de respaldos en esta etapa. Sin commit, push ni publicación. E5.5 no se inició.
