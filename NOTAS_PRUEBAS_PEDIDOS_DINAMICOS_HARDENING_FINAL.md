# Suite A33 Planificación de Pedidos — Etapa 3/3

Fecha y hora de entrega: 22/06/2026 14:00

## Cambios aplicados

- Se reforzó la lectura de pedidos nuevos con `items`, `productId`, nombre snapshot, precio snapshot, cantidades, subtotales y total.
- Se mantuvo compatibilidad con pedidos legacy de Pulso, Media, Djeba, Litro y Galón sin migración destructiva.
- Se agregó vista limpia de detalle en modal para pedidos activos e históricos, sin mostrar IDs internos.
- Se reforzó el Histórico para permitir ver detalle y cargar como nuevo por separado.
- Se adaptó la exportación Excel para conservar columnas legacy y agregar detalle de productos dinámicos.
- Se agregó hoja Excel “Detalle productos” con una línea por producto/pedido.
- Se agregó detalle de productos al archivo calendario `.ics`.
- Se amplió la búsqueda para encontrar productos guardados por snapshot y lotes relacionados.
- Se ajustó Planificación para tomar productos activos de Catálogos sin depender del checkbox POS/vendible.
- Se actualizó versionado/cache del módulo Pedidos.

## Pruebas técnicas

- `node --check pedidos/script.js` ejecutado correctamente.
- Cambios limitados al módulo `pedidos/` y nota de pruebas.
