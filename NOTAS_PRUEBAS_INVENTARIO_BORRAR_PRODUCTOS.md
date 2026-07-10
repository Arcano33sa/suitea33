# Suite A33 — Inventario — Borrar Productos

Fecha y hora de entrega: 22/06/2026 07:52

## Cambios aplicados
- Se agregó botón visible “Borrar Productos” en Inventario → Producto terminado.
- Se agregó confirmación obligatoria antes de ejecutar la acción.
- La acción deja en 0 únicamente existencias de producto terminado, incluyendo productos legacy y dinámicos por productId.
- No toca envases, tapas/corchos, líquidos, varios, lotes, POS, Finanzas ni Caja Chica.
- Se reforzó el guardado conservador para persistir cambios de finished y finishedByProductId.
- La trazabilidad queda interna sin texto visible adicional de ajuste.

## Pruebas estáticas
- node --check inventario/script.js OK.
- Revisión de referencias del botón y query de script/SW OK.
