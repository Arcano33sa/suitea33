# E6.1 — Estados de seguimiento de Pedidos

Fecha: 2026-10-04. Etapa autorizada individualmente; cierre local, sin commit ni push.

## Acuerdos y resultado

Pedido completo y Pedido rápido admiten Pendiente, En preparación, Listo, Entregado y Cancelado. Los cambios son manuales y permiten corregir el estado; no son una secuencia obligatoria. No registran ventas, reservas, producción ni movimientos de inventario. Entregas parciales, relaciones estructuradas con lotes y demanda pertenecen a etapas posteriores que requieren su propia autorización.

Los formularios, tablas, detalles y tarjetas muestran el estado correspondiente. Los rápidos en preparación y listos permanecen en pendientes de entrega; los entregados y cancelados aparecen en el histórico y pueden reabrirse mediante el control existente. No se archivan ni eliminan pedidos completos automáticamente.

Centro de Mando cuenta Pendiente, En preparación y Listo como pendientes; excluye Entregado y Cancelado. Se conserva la ventana de 15 días de rápidos y las reglas de fecha y fabricación previas. Sus señales temporales no constituyen evidencia de producción real.

Excel incorpora Estado al final del resumen completo, conserva la columna Entregado y las posiciones anteriores, y muestra los cinco estados en resumen y detalle rápidos. ICS añade el estado en la descripción; no cancela ni sincroniza eventos de calendarios externos automáticamente.

El almacenamiento compartido y el contrato de importación de rápidos conservan los estados nuevos. No cambian claves, versiones de esquema ni políticas de fusión por identidad y fecha. Las lecturas no reescriben automáticamente registros históricos. Para datos contradictorios anteriores se conserva la interpretación histórica de cada modalidad: estado explícito de completos y marca booleana de rápidos. Los estados nuevos explícitos prevalecen sobre una antigua marca de entrega. Se conservan campos adicionales y fotografías de productos.

## Archivos de aplicación

- `pedidos/index.html`: opciones y encabezado de estado.
- `pedidos/script.js`: lectura, validación, guardado, presentación y exportaciones.
- `assets/js/a33-storage.js`: normalización de rápidos.
- `configuracion/script.js`: contrato de respaldo/importación de rápidos.
- `centro-mando/app.js`: lectura de pendientes de seguimiento.

## Pruebas y revisión

- Catálogo completo: **103/103 aprobadas**, incluidas **23 de Chrome**; sin fallos, omisiones ni exclusiones históricas. Tres aliases evitan ejecución duplicada.
- Tras el ajuste final de precedencia histórica: **6/6 dirigidas aprobadas**, incluidas tres de Chrome (E6.1, recuperación E5.3 y conflictos E5.8). Además, modelo y flujo rápido anteriores aprobados individualmente.
- La prueba VM nueva verifica los cinco estados, compatibilidad de datos contradictorios históricos, lectura sin migración, calendario rápido, importación y lectores de Centro de Mando.
- El smoke nuevo de Chrome utiliza formularios reales, recarga tras cada estado, genera libros Excel mediante la librería real y verifica etiquetas de estado, columna histórica de entrega y cantidades de inventario intactas.
- El catálogo completo incluye los controles de respaldo, exportación sin conexión y guardado seguro existentes. Las pruebas usan almacenamiento temporal aislado y no acceden a datos reales del usuario.
- `tests/runner.spec.cjs` aprobado; sintaxis de los cuatro scripts modificados válida; `git diff --check` sin incidencias. Diff revisado: únicamente los cinco archivos de aplicación indicados, dos pruebas nuevas, catálogo y estos informes.
- Resultados detallados en `RESULTADOS_ETAPA6_1.json`, diferenciando regresión integral y cierre posterior al ajuste histórico.

## Límites y pendientes

Los estados son seguimiento manual: Listo no verifica producción y Entregado no acredita una venta ni una salida de stock. Cancelar conserva el pedido y no ejecuta anulaciones externas. No se crea una bitácora de transiciones. Excel añade una columna al resumen completo; consumidores externos que exijan un número exacto de columnas deberán admitirla.

No se modificaron dependencias, PWA, Service Workers, cachés, versiones, fórmulas, reglas de inventario ni los informes previos. No se eliminaron históricos o respaldos. E6.1 queda lista para revisión manual; la siguiente etapa no está ejecutada.
