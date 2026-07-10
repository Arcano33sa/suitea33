# Suite A33 — Catálogos → Costos — Etapa 3/4

## Alcance aplicado

- Lectura sin alteración de `arcano33_recetas_v1`, fuente vigente de Calculadora de Producción.
- Cálculo automático para Vino, Vodka, Jugo, Sirope y Agua pura.
- Fórmula: `(Precio de compra / ML comprados) × ML usados en receta`.
- Enlace por ID estable del producto mediante metadatos de receta, con compatibilidad histórica por presentación y nombre.
- Recalculo al cambiar Precio/ML, al guardar, al abrir Costos, al volver a la pestaña y al detectar cambios de almacenamiento.
- Celdas informativas de solo lectura con detalle accesible mediante tooltip.
- Botella, Calcomanía y Total permanecen sin cálculo en esta etapa.

## Pruebas ejecutadas

- Fórmula de Vino: C$151 / 1000 ml × 132.45 ml = C$20.00 visual.
- Cambio de Precio recalcula todas las celdas relacionadas.
- Ingrediente ausente muestra C$0.00.
- Producto dinámico nuevo con Receta calcula automáticamente.
- Producto renombrado conserva la receta por ID estable.
- Precio vacío muestra Pendiente y no genera NaN.
- ML igual a cero muestra advertencia y el guardado continúa bloqueado por la validación existente.
- Receta ilegible no rompe la tabla.
- Formato monetario con dos decimales.
- Tooltip incluye Precio, ML comprados, costo por ml, ML usados y resultado.
- `node --check catalogos/script.js`: correcto.

## Regresión protegida

No se modificaron Calculadora de Producción, Inventario, Lotes, POS, Planificación de Pedidos ni la estructura de sus datos.
