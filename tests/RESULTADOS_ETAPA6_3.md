# E6.3 — Vínculos informativos con lotes completos

Fecha: 2026-10-04. Etapa autorizada individualmente, con acuerdo explícito de vincular lotes completos. Cierre local sin commit ni push.

## Acuerdo y resultado

Pedido completo y Pedido rápido permiten vincular lotes completos mediante un selector. Son referencias informativas: no asignan cantidades por producto, no reservan existencias ni modifican inventario, producción, ventas, entregas acumuladas o estados del pedido/lote.

El botón **Vincular lotes** está en los pedidos activos completos y en las tarjetas rápidas, incluidas las históricas. Se usa después de guardar el pedido. El editor muestra las referencias existentes, permite añadir o quitar vínculos y exige guardar explícitamente. El campo `lotesRelacionados` conserva su función de texto libre; no se interpreta ni convierte automáticamente, y se muestra por separado. El histórico completo conserva los vínculos y los muestra en detalle; no se añade edición del archivado. Cargar un archivado como nuevo no copia los vínculos del pedido original.

Los códigos vinculados aparecen en el detalle completo y las tarjetas rápidas y se pueden buscar en las listas. ICS incluye el resumen informativo. Excel añade la hoja **Lotes vinculados** con identidad, código al vincular, código actual cuando se localiza, fecha de referencia, condición de localización y texto histórico. No desplaza columnas ni modifica las hojas previas.

## Identidad, compatibilidad y guardado

Se conserva dentro del pedido un campo adicional `lotesVinculados`, schemaVersion 1, con referencias y fecha de actualización. Cada referencia guarda la identidad principal, sus identidades históricas alternativas y una fotografía del código y la fecha. Se prefieren IDs existentes; para lotes sin ID se acepta un código inequívoco, sin inventar identidades por tiempo ni modificar los registros de Lotes.

Se conservan como alternativas loteId, id, operationId, productionOperationId, batchId y los códigos existentes codigo/batchCode/code. Se muestra preferentemente el código original `codigo`. Un ID añadido posteriormente a un lote histórico no pierde la referencia por su código; un cambio de código mantiene el vínculo por ID. Coincidencias múltiples se marcan **Identidad ambigua** y no se ofrecen para nuevos vínculos. Los registros sin identidad no se ofrecen. No se normalizan ni reescriben los códigos de lote.

Un lote no encontrado muestra **No localizado**; la referencia guardada y su código no se eliminan automáticamente. Un catálogo ilegible bloquea el editor conservando referencias y datos. Un registro de vínculos inválido bloquea su edición y el guardado ordinario, sin corregirlo silenciosamente. Antes de guardar se vuelve a leer el catálogo y se comprueba que los nuevos vínculos sigan localizándose de forma única.

El guardado compara el contenido completo del pedido con su fotografía inicial y usa los controles compartidos de E5. Conflictos, bajas, fallos de escritura o falta de confirmación conservan la selección pendiente. Se comprueba persistencia antes de informar éxito. Cerrar con cambios requiere confirmación; salir de la página utiliza el aviso del navegador.

La edición ordinaria completa preserva el campo explícitamente; la rápida y los contratos actuales de almacenamiento y respaldo conservan los campos adicionales del pedido. No hay nuevas claves independientes de persistencia ni cambios a las versiones históricas de respaldo.

## Archivos de esta etapa

- `pedidos/index.html`: editor modal, identificación del texto libre y resumen en detalle.
- `pedidos/script.js`: referencias, selector, validación, persistencia, conflictos, lectores y exportaciones.
- `tests/a33-pedidos-lotes-e63.smoke.cjs` y `.browser.smoke.cjs`: pruebas dirigidas.
- `tests/catalogo.json`: registro de ambas pruebas.
- `tests/RESULTADOS_ETAPA6_3.md` y `.json`: informe y resultados.

E6.1 y E6.2 estaban pendientes de commit al comenzar y se conservaron. El diff frente a HEAD reúne las tres etapas. E6.3 no añadió modificaciones a los archivos de almacenamiento, Configuración o Centro de Mando que ya figuraban modificados por E6.1.

## Verificación

- Catálogo completo final: **107/107 aprobadas**, incluidas **25 de Chrome**, sin fallos, omisiones ni exclusiones históricas. Tres aliases evitan duplicados.
- VM: identidad por ID y código histórico, cambio de código, incorporación posterior de ID y código canónico, coincidencia ambigua, referencias ausentes, registros inválidos, lectura sin escrituras, conservación en contratos compartidos y de importación, y exportación ICS rápida.
- Chrome: selector de ambos pedidos, ausencia de migración automática, prevención de duplicados, guardado, recarga, edición ordinaria, cierre conservador, conflicto entre pestañas aunque updatedAt no cambie, escritura rechazada, código actual frente al guardado, lote no localizado, catálogo ilegible y hoja Excel.
- Las pruebas comparan los registros de Lotes antes/después de las acciones de la aplicación. Los cambios de catálogo necesarios para simular desapariciones o identidad histórica se hacen únicamente en el almacenamiento temporal de la prueba.
- Inventario, ventas, eventos, productos, materias primas y reempaques permanecieron intactos. Las cantidades comerciales, precios, totales, anticipo, saldo y texto histórico del pedido permanecieron iguales. La edición ordinaria recaptura la fecha de su fotografía de producto como ya ocurría; se verifica el contenido comercial sin exigir que esa fecha sea inmutable.
- La regresión incluye los flujos de guardado seguro, respaldos, exportaciones sin conexión, E6.1 y E6.2.
- `tests/runner.spec.cjs` aprobado; sintaxis de Pedidos válida; `git diff --check` sin incidencias. Diff revisado e inspección visual del modal en Chrome completada.
- Todas las pruebas usan almacenamiento temporal aislado. No se leyeron ni alteraron datos reales del usuario.

## Límites y pendientes

Localizado significa que la referencia encuentra un registro único; no demuestra disponibilidad, producción para ese pedido, compatibilidad de productos o cantidades suficientes. Se permiten vínculos informativos con lotes de cualquier estado, incluidos históricos cerrados. No existe asignación de cantidades, reserva, bitácora de vínculos por fecha ni escritura recíproca en el lote.

Los códigos heredados sin ID se comparan con los valores conservados; no se adivinan equivalencias entre formatos distintos. Si cambian todas las identidades y códigos, se conserva la referencia como no localizada para revisión manual. Las selecciones sin guardar se conservan ante fallos del editor y tienen advertencia al salir; no se recuperan automáticamente después de una caída o cierre del navegador.

No se añadieron dependencias ni cambios de PWA, Service Workers, cachés, versiones o infraestructura. No se borraron ni sobrescribieron datos reales, históricos o respaldos. La etapa queda lista para revisión manual; E6.4 no está ejecutada.
