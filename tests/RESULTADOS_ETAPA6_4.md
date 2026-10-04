# E6.4 — Demanda informativa por producto y fecha

Fecha: 2026-10-04. Etapa autorizada individualmente, con acuerdo explícito de contar como estimación identificada la cantidad completa cuando no haya acumulado de entregas. Cierre local sin commit ni push.

## Acuerdos y resultado

La nueva sección desplegable **Demanda informativa por producto y fecha** en Pedidos considera Pedido completo y Pedido rápido activos en Pendiente, En preparación y Listo. Excluye Entregado, Cancelado y la colección de completos archivados. Usa la fecha de entrega, no la fecha de fabricación. Los filtros Desde/Hasta son inclusivos; vacíos significan todas las fechas, incluidos pendientes vencidos. No aplica la ventana de 15 días del Centro de Mando ni modifica sus alertas.

Por cada producto se calcula la cantidad pedida menos el acumulado registrado. Si falta un acumulado para esa línea, se cuenta la cantidad completa como **Estimado: sin registro de entregas**. Esto incluye productos sin línea de acumulado dentro de un pedido que sí tiene registro para otros productos. Un acumulado cero explícito es registro válido. Se separan pendiente con registro, estimado sin registro y total informativo, sin cambiar estados automáticamente.

Se agrupan fecha e identidad productId persistida. Las fotografías con el mismo ID pueden aportar nombres distintos que se muestran juntos; no se consulta el precio o nombre vigente del catálogo para recalcular. Productos históricos sin productId permanecen separados por pedido y línea, aunque compartan nombre o familia. No se infiere una asociación al catálogo.

Se muestran los pedidos y líneas que aportan cada total. Fechas inválidas, identidades duplicadas, cantidades o productos incompletos y registros de entrega inválidos se muestran **Para revisión**, fuera del total. El resumen identifica cuántos pedidos quedan excluidos por revisión y no los repara. Una colección ilegible o estructuralmente incompleta bloquea todo el resumen y su exportación; no se presenta una demanda parcial como completa.

El panel se actualiza al abrirlo, cambiar fechas, solicitar actualización, guardar cambios que refrescan las listas o recibir cambios de pedidos desde otra pestaña mientras está abierto. Al recargar, el panel y período no se persisten; no se crean claves de configuración nuevas.

## Exportación

**Exportar demanda a Excel** genera un archivo independiente `demanda_pedidos.xlsx` con cuatro hojas: Demanda, Pedidos considerados, Revisión y Período. Usa el mismo cálculo y fechas que la pantalla, separa cantidades registradas y estimadas y deja el acumulado vacío cuando no existe. Identifica el origen de cada cálculo y las líneas no incluidas por revisión. No modifica la exportación general de Pedidos ni las hojas de etapas anteriores. Una lectura incompleta o un período inválido bloquea la exportación de demanda.

## Seguridad y compatibilidad

Consultar, filtrar y exportar son operaciones de lectura: no guardan pedidos, entregas, históricos, lotes, inventario, ventas, reservas, producción o preferencias. No se modifican fórmulas financieras, fotografías de precios ni estados. La demanda es informativa; no representa existencias ni compromiso formal de inventario.

Se usan las interpretaciones históricas vigentes de estado y productos. Las cantidades históricas válidas con coma decimal siguen siendo legibles en completos. Se inspeccionan las cantidades originales antes de que una normalización pudiera descartar una línea inválida y reducir silenciosamente el total. No se limpia ni corrige el dato original.

## Archivos de esta etapa

- `pedidos/index.html`: sección de consulta, filtros, tabla, fuentes y revisión.
- `pedidos/script.js`: lectura conservadora, cálculo, presentación, actualización y exportación de demanda.
- `tests/a33-pedidos-demanda-e64.smoke.cjs` y `.browser.smoke.cjs`: pruebas dirigidas.
- `tests/catalogo.json`: registro de ambas pruebas.
- `tests/RESULTADOS_ETAPA6_4.md` y `.json`: cierre y resultados.

Los cambios de E6.1, E6.2 y E6.3 estaban pendientes de commit al comenzar y se conservaron. El diff frente a HEAD reúne las cuatro etapas. E6.4 no añadió cambios a almacenamiento compartido, Configuración, Centro de Mando o Lotes.

## Verificación

- Regresión integral: **109/109 aprobadas**, incluidas **26 de Chrome**. Sin omisiones ni exclusiones históricas; tres aliases evitan duplicados.
- Tras precisar el tratamiento de productos sin línea de acumulado: **2/2 dirigidas aprobadas**, incluida Chrome. El informe JSON distingue ambas ejecuciones.
- VM: registrado frente a estimado, mezcla de estados y fechas, límites inclusivos, período inválido, saldo cero, acumulado ausente por producto, registros inconsistentes, pedidos duplicados, identidades históricas independientes, cantidades con coma, colección ilegible y lectura rechazada. Se verifica ausencia de escrituras.
- Chrome: pantalla y Excel concilian para el mismo período, las estimaciones se identifican, los históricos homónimos no se fusionan, los archivados no aportan demanda, las incidencias no aportan al total y el período inválido bloquea exportación. Se verifica actualización por otra pestaña y por una entrega real en la misma página, además de bloqueo por colección ilegible.
- Las consultas, filtros y exportación conservaron exactamente los valores almacenados de pedidos completos, rápidos, archivados y lotes. Los únicos cambios de pedidos posteriores son simulaciones explícitas del fixture temporal y un guardado de entrega mediante su formulario existente para comprobar actualización.
- Inventario, ventas, eventos, productos, insumos y reempaques se compararon antes y después y quedaron iguales. No se usaron datos reales.
- La regresión incluye guardado seguro, respaldo, exportaciones sin conexión y E6.1–E6.3.
- `tests/runner.spec.cjs` aprobado; sintaxis de Pedidos válida; `git diff --check` sin incidencias; diff revisado e inspección visual de Chrome realizada.

## Hallazgo adicional comprobado, fuera de E6.4

Una prueba con una línea `null` dentro del array de productos de un Pedido completo impidió el arranque de la vista existente: `getPriceSnapshotFromPedido` intenta leer `item.productKey`. Se comprobó que esa lectura ya existe en HEAD, antes de las etapas locales de E6. El fallo se reprodujo únicamente con datos dañados creados en almacenamiento temporal; no se inspeccionaron registros reales.

El lector nuevo de demanda detecta la línea incompleta y excluye ese pedido del cálculo en su prueba de modelo, pero no corrige el lector financiero previo. Si ese daño está presente desde el arranque, la aplicación puede fallar antes de abrir la sección de demanda. Este caso requiere revisión y autorización independiente; no se modificó el lector ni se repararon datos.

La prueba de Chrome separa los casos de consulta con IDs duplicados de los de guardado válido: E5 bloquea correctamente escrituras sobre una colección con identificadores duplicados. Los ajustes necesarios del fixture son explícitos y no representan reparación automática de la aplicación.

## Límites y pendientes

El total excluye las incidencias identificadas y puede contener cantidades estimadas; debe leerse junto con sus fuentes y revisión. No demuestra disponibilidad ni reserva productos. Las lecturas de las dos colecciones no son una instantánea atómica entre pestañas; Actualizar demanda permite obtener nuevamente el cálculo. No se incorporó demanda de completos archivados ni se alteraron las alertas temporales del Centro de Mando.

No se añadieron dependencias, PWA, Service Workers, cachés, versiones o infraestructura. No se borraron ni sobrescribieron datos reales, históricos o respaldos. E6.4 queda lista para revisión manual; E6.5 no está ejecutada.
