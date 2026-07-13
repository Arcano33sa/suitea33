# Suite A33 — Productos como fuente única — Etapa 4/8

Fecha de validación: 12/07/2026 21:03

## Resultado

19/19 pruebas obligatorias cubiertas y aprobadas mediante pruebas automatizadas del contrato de Producción, pruebas VM de Lotes/Storage, auditoría estática y validación de sintaxis JavaScript.

1. Catálogo vacío: Calculadoras y Lotes sin productos operativos.
2. Producto activo sin Receta: excluido.
3. Producto inactivo con Receta: excluido.
4. Producto activo con Receta: incluido.
5. Nombres similares: separados por `productId`.
6. Cambio de nombre: conserva identidad, Receta y relaciones por ID.
7. Producción de 10: producto terminado +10.
8. Producción de 10: Envase −10.
9. Producción de 10: Tapa/Corcho −10.
10. Envases insuficientes: guardado bloqueado sin cambios parciales.
11. Tapas/Corchos insuficientes: guardado bloqueado sin cambios parciales.
12. Líquidos insuficientes: guardado bloqueado sin cambios parciales.
13. Doble acción concurrente: una sola aplicación de Inventario.
14. Reintento/recuperación: sin movimientos duplicados.
15. Calculadora Temporal: no escribe Lotes ni Inventario oficial.
16. Lote antiguo: continúa legible mediante snapshot histórico.
17. Lote antiguo: no alimenta selectores ni catálogo operativo nuevo.
18. Ejecución VM y módulos revisados sin errores de consola durante las pruebas automatizadas.
19. Sintaxis validada en 10 archivos JavaScript y estructura HTML parseada.

## Controles adicionales

- `productId` es la identidad operativa; la Letra no reconstruye productos.
- Letras duplicadas entre productos fabricables bloquean la operación.
- Envase y Tapa/Corcho deben estar asignados explícitamente por ID.
- No existe inferencia de Envase/Tapa por nombre del producto.
- Los líquidos se calculan desde el `recipeSnapshot` real usado en la producción.
- La operación oficial usa `operationId`, bloqueo de doble acción y diario recuperable.
- Los encabezados P/M/D/L/G permanecen ocultos y solo se muestran para lotes históricos que realmente contienen esos campos.
- El día del código de lote conserva dos dígitos.
- No se agregaron dependencias.
