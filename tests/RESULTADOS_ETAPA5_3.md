# E5.3 — Recuperación de formularios de Pedidos

## Acuerdos y alcance

La autorización E5.3 se amplió por respuesta explícita del usuario a Pedido completo y Pedido rápido. Objetivo: conservar formularios pendientes y recuperarlos por elección explícita, sin registrar pedidos ni afectar inventario durante la recuperación. Se mantienen formatos, precios históricos, identificadores y comprobaciones existentes.

## Implementación

- Se añadió un panel de borradores locales con Ver borradores disponibles, Recuperar y Descartar. Nunca se aplica una copia automáticamente al iniciar.
- Cada sesión de página y modalidad tiene su propia clave a33_pedidos_form_draft_v1_. Una pestaña nueva o recargada crea otra identidad de trabajo y no sobrescribe la copia de otra sesión. La recuperación copia al formulario actual y conserva la copia de origen para descarte explícito; no hay caducidad ni limpieza automática de copias antiguas.
- Captura campos incompletos, cliente, fechas, cantidades crudas, productos, precios, identificador de reintento, destino de edición y revisión original. Pedido completo conserva además líneas históricas, pagos, referencias, códigos y origen archivado. Pedido rápido conserva líneas y cantidades escritas antes del evento change.
- La recuperación conserva precios anteriores cuando el catálogo cambió mediante el mecanismo existente de líneas históricas; conserva identidad del cliente aunque ya no aparezca en el catálogo. No crea clientes durante la recuperación.
- Pedido rápido mantiene una identidad estable al reintentar y valida las cantidades visibles antes de guardar para no aplicar una cantidad anterior al texto recuperado.
- En formularios recuperados, un destino eliminado/modificado o un identificador ya registrado bloquea guardado y conserva los cambios. Se mantienen las comprobaciones previas de revisión e idempotencia. No se implementa un sistema general de conflictos entre pestañas.
- Limpiar o sustituir un formulario pendiente pide confirmación. El guardado confirmado limpia únicamente su copia de trabajo; las copias de origen recuperadas permanecen disponibles.
- Fallos de persistencia muestran aviso y conservan el formulario y la última copia válida. Una modalidad guardada no oculta un fallo pendiente de la otra. Hay captura en input/change, acciones del formulario y eventos de ocultamiento/salida, más advertencia beforeunload para trabajo pendiente.
- Copias con estructura incompatible se conservan sin aplicar. Un producto desaparecido con cantidad inválida impide recuperar esa copia, conservándola para revisión.

## Verificación

- Prueba VM aprobada: captura y estructura, rechazo de formatos incompatibles, almacenamiento que devuelve false, conservación de la copia anterior, descarte cancelado/confirmado, identidades de ambas modalidades y destinos cambiados/eliminados/ya registrados.
- Chrome aprobado en contexto y origen temporal: formularios reales, recarga sin recuperación automática, botones Recuperar de ambas modalidades, campos incompletos, precio cambiado conservado, cantidad cruda previa a change, dos pestañas con claves independientes y copias de origen intactas. Recuperar no cambió pedidos registrados.
- Smoke Chrome de guardado posterior aprobado para ambas modalidades: ID original, cantidad y precio conservados; cliente ausente del catálogo conserva ID. También se comprobó bloqueo del duplicado y fallo simulado de escritura del borrador sin perder el formulario.
- Regresión funcional local: 66 aprobadas y los mismos siete fallos anteriores; 17 pruebas de navegador omitidas por el ejecutor local. La nueva prueba Chrome se ejecutó aparte y aprobó; las otras 16 no se repitieron en este cierre. Tras los ajustes finales se repitieron las pruebas dirigidas, Chrome y las cuatro pruebas históricas de Pedidos rápidos y E5.1, todas aprobadas.
- Sintaxis de pedidos/script.js, tests/runner.spec.cjs y git diff --check aprobados. Diff revisado.

## Archivos y límites

E5.3: pedidos/index.html, pedidos/script.js, tests/catalogo.json, dos pruebas dirigidas y este informe. El árbol conserva también los cambios autorizados anteriores de E5.1 y E5.2, todavía sin commit. No se modificaron PWA, Service Workers, cachés, versiones, dependencias ni reglas de inventario/producción/reservas.

Las copias locales pueden acumularse hasta descarte explícito y dependen del almacenamiento de este navegador. Un fallo de escritura conserva la última copia confirmada, no garantiza recuperar la edición más reciente tras cierre forzado. Los avisos de salida dependen del navegador. La comprobación de conflictos sigue basada en las revisiones existentes y no equivale a una transacción global. No se amplió cobertura personalizada de respaldos en esta etapa. Sin commit ni push; E5.4 no se inició.
