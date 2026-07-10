# NOTAS PRUEBAS POS — Vaso sin Receta — Etapa 4/6

Fecha y hora de entrega: 21/06/2026 21:19

## Cambios aplicados

- POS mantiene la venta de productos activos + POS marcado sin exigir Receta, Letra, Envase ni Tapa.
- Vaso queda normalizado como producto vendible normal sin Receta y sin Letra.
- La normalización de Vaso respeta estados explícitos del usuario para Activo, POS y Manejar inventario.
- Productos sin Receta no pasan por candado de Lotes/FIFO; solo se valida stock si manejan inventario.
- El snapshot de venta conserva productId, nombre, precio y manageStock real del catálogo.
- El descuento de inventario de Vaso sigue siendo por Product ID propio, sin descontar Galón, líquido, envase ni tapa.
- Se actualizó rev/cache PWA para reflejar app.js nuevo.

## Pruebas realizadas

- `node --check pos/app.js`
- `node --check pos/sw.js`
- `node --check assets/js/a33-release.js`
- `find . -name '*.js' -not -path './*/vendor/*' -print0 | xargs -0 -n1 node --check`
- Verificación estática de filtros: POS usa Activo + POS; Calculadora/Temporal usan Receta; Lotes usa Receta + Letra.
