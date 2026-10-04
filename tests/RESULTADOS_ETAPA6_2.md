# E6.2 — Cantidades acumuladas entregadas por producto

Fecha: 2026-10-04. Una etapa autorizada individualmente; cierre local sin commit ni push.

## Acuerdos funcionales y resultado

Se implementaron cantidades acumuladas por producto en Pedido completo y Pedido rápido. Se muestra cuánto se pidió, cuánto se ha entregado y cuánto queda pendiente. Se conservan los cinco estados manuales de E6.1: completar las cantidades no cambia automáticamente a Entregado. No hay bitácora de entregas por fecha, movimientos de inventario, ventas, producción, reservas ni vínculos nuevos con lotes.

Los pedidos activos completos y todas las tarjetas rápidas ofrecen **Cantidades entregadas**. El editor permite guardar el acumulado de cada producto, corregirlo y ver inmediatamente el pendiente. La lista activa completa, las tarjetas rápidas y el detalle completo muestran el resumen. El histórico completo conserva su registro y lo muestra en detalle; no incorpora edición de cantidades del archivado. Cargar un archivado como nuevo conserva el comportamiento previo de crear otro pedido, sin copiar entregas del pedido original.

Excel añade una hoja **Entregas**, con tipo de pedido, identidad, estado, producto, cantidad contratada, entregado acumulado, pendiente y condición del registro. Las hojas y posiciones de columnas existentes permanecen como estaban al iniciar E6.2.

## Compatibilidad y guardado

El registro se guarda dentro del pedido en `entregasAcumuladas` (schemaVersion 1, productos por identidad y fecha de actualización). Se mantiene separado de las líneas financieras para evitar que los normalizadores de productos pierdan estos datos. Los lectores de almacenamiento e importación existentes conservan el campo adicional; la edición ordinaria completa lo preserva explícitamente y la rápida conserva el objeto original.

No se infieren cantidades a partir de Pendiente, Entregado ni ningún otro estado. Un pedido sin registro muestra **Sin registro de cantidades**, incluso si históricamente figura como entregado. Leer o abrir el editor no migra ni reescribe los datos. Excel deja las cantidades acumuladas y pendientes vacías cuando no existe registro.

Se usa productId o clave histórica; las líneas históricas sin identidad permanecen independientes por posición y fotografía del nombre, sin fusionarlas por texto. Las cantidades deben ser finitas y estar entre cero y lo pedido; las rápidas deben ser enteras en el editor. Se conserva la posibilidad histórica de cantidades fraccionarias en completos. No se permite reducir lo contratado por debajo de lo entregado ni quitar o cambiar la identidad de un producto con acumulado positivo. Un registro inválido se conserva y bloquea el guardado ordinario; no se corrige silenciosamente.

El editor compara el contenido completo del pedido con la fotografía tomada al abrirlo, además de usar los controles de almacenamiento compartido de E5. Los conflictos, bajas y errores de escritura conservan los campos visibles. Se comprueba la persistencia antes de informar éxito. Cerrar con cambios requiere confirmación y salir de la página solicita el aviso del navegador cuando hay cambios pendientes.

## Archivos de esta etapa

- `pedidos/index.html`: editor modal y resumen en detalle.
- `pedidos/script.js`: modelo acumulado, validaciones, controles de edición/guardado, presentación y hoja Excel.
- `tests/a33-pedidos-entregas-e62.smoke.cjs`: prueba dirigida de modelo, datos históricos y respaldo.
- `tests/a33-pedidos-entregas-e62.browser.smoke.cjs`: smoke funcional de Chrome con formularios reales y almacenamiento aislado.
- `tests/catalogo.json`: registro de las dos pruebas.
- `tests/RESULTADOS_ETAPA6_2.md` y `.json`: cierre y resultados.

Al comenzar estaban pendientes los cambios locales de E6.1. Se conservaron; E6.2 no añadió cambios a `assets/js/a33-storage.js`, `configuracion/script.js` ni `centro-mando/app.js`. El diff frente a HEAD reúne las dos etapas todavía sin commit, por lo que esos archivos previos siguen apareciendo en Git.

## Verificación

- Catálogo completo final: **105/105 aprobadas**, incluidas **24 de Chrome**. Sin fallos, omisiones o exclusiones históricas; tres aliases evitan ejecución duplicada.
- VM nueva: acumulados y pendientes por producto, estados manuales, límites, cantidades inválidas, claves duplicadas, productos retirados, lectura sin escritura, líneas históricas homónimas independientes y conservación en almacenamiento y contrato de importación.
- Chrome nueva: parcial y completo, recarga, conservación al editar normalmente, reducción bloqueada, confirmación al cerrar, conflicto con otra pestaña aunque updatedAt no cambie, fallo de escritura, Excel y estado manual intacto.
- La prueba de Chrome compara inventario, ventas, eventos, productos, insumos y reempaques antes y después. También verifica precios, total, anticipo y saldo del pedido completo. No usa datos reales.
- La regresión incluye recuperación E5.3, conflictos E5.8, estados E6.1, respaldos y exportaciones sin conexión existentes.
- `tests/runner.spec.cjs` aprobado; sintaxis de Pedidos válida; `git diff --check` sin incidencias. Se inspeccionó visualmente el modal de Chrome y se revisó el diff.
- El primer ensayo local detectó que una prueba E5.3 extrae el tramo final del script. Se ubicó el bloque nuevo antes de ese tramo, conservando la prueba y el comportamiento de E5.3. La ejecución final completa la aprobó.

## Límites y pendientes

El avance es informativo y puede diferir del estado manual. No confirma una venta ni una salida física. Se conserva solo el acumulado actual, no la historia de correcciones o fechas individuales. Las cantidades sin guardar permanecen en el editor ante errores y cuentan con advertencia al salir; no hay recuperación automática de este editor después de cerrar el navegador o una caída.

No se agregaron dependencias ni se modificaron PWA, Service Workers, cachés, versiones, fórmulas o políticas de inventario. No se borraron datos, históricos o respaldos. E6.2 queda lista para revisión manual; la siguiente etapa requiere autorización independiente.
