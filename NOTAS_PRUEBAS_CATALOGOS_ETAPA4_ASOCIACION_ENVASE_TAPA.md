# Suite A33 Catálogos — Etapa 4/5 Asociación Producto → Envase / Tapa

Fecha y hora de entrega: 21/06/2026 19:54

## Cambios aplicados
- Se agregaron campos compactos `Envase` y `Tapa` en Crear/Editar Producto.
- Se guardan las llaves estables `envaseId` y `tapaId` en cada producto.
- El listado de Productos ahora muestra Nombre, Receta, Letra, POS, Envase y Tapa de forma compacta.
- Se aplican asociaciones conservadoras para Pulso, Media, Djeba, Litro, Galón y Catrina/Catrina Jr. cuando existen los productos y catálogos.
- Catrina queda preparada con `Botella Catrina` + `Corcho Catrina`, sin lógica de tapa incluida.
- Se mantiene compatibilidad con productos antiguos sin `envaseId`/`tapaId`.
- Se actualizó el cache-busting del módulo Catálogos.

## Pruebas realizadas
- `node --check catalogos/script.js`
- `node --check catalogos/sw.js`
- `node --check pos/app.js`
- `node --check lotes/script.js`
- Revisión estática de formularios, selectores, helpers y URLs de cache.

## Nota
No se tocó POS, Calculadora de Producción, Calculadora Temporal, Lotes, Inventario operativo, Finanzas, Caja Chica ni Recibos.
