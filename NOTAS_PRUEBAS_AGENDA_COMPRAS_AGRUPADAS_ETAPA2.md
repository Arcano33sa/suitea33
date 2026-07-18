# Suite A33 — Agenda — Compras agrupadas — Etapa 2/3

## Cambios aplicados

- Listado e Histórico representan cada compra agrupada como un único registro.
- Encabezado compacto con Fecha necesaria, cantidad de artículos, total general, Prioridad y Estado.
- Acción Ver/Ocultar con detalle completo de artículos, cantidades, unidades, precios históricos, subtotales, categorías y notas.
- Edición completa con agregación, cambio de cantidades, retiro de artículos y retención de Fecha, Prioridad, Estado y Notas.
- Artículos repetidos suman cantidad y conservan el precio histórico existente.
- Artículos nuevos usan la fotografía actual de Materia Prima.
- Presupuesto calcula totales y cantidades por grupos de compra, no por artículos.
- Estados Hecho, Cancelado y Pendiente actúan sobre todo el grupo y recalculan inmediatamente.
- Centro de Mando lee `purchaseGroup`, muestra cada compra como un solo registro y separa Reuniones, Tareas y Compras.
- Compatibilidad reforzada para compras antiguas de un artículo, incluso cuando no poseen ID moderno de Materia Prima.
- Caché PWA de Agenda incrementada para publicar los cambios.

## Smoke test obligatorio

1. PASS — Cada compra agrupada aparece como un solo registro.
2. PASS — El listado muestra cantidad de artículos y total general.
3. PASS — Ver muestra todos los artículos.
4. PASS — Editar carga la compra completa.
5. PASS — Agregar artículo en edición mantiene Fecha necesaria.
6. PASS — Agregar artículo en edición mantiene Prioridad.
7. PASS — Agregar artículo en edición mantiene Estado.
8. PASS — Agregar artículo en edición mantiene Notas.
9. PASS — Editar cantidad recalcula subtotal y total.
10. PASS — Quitar artículo recalcula subtotal y total.
11. PASS — No permite guardar sin artículos.
12. PASS — Un artículo repetido suma cantidad.
13. PASS — Los artículos históricos mantienen su precio.
14. PASS — Los artículos nuevos toman el precio actual.
15. PASS — Marcar Hecho actúa sobre toda la compra.
16. PASS — Cancelar actúa sobre toda la compra.
17. PASS — Reactivar actualiza correctamente los totales.
18. PASS — Presupuesto pendiente suma solo compras agrupadas Pendientes.
19. PASS — Total comprado suma solo compras agrupadas Hechas.
20. PASS — Canceladas no suman.
21. PASS — La cantidad de compras cuenta grupos, no artículos.
22. PASS — Centro de Mando muestra Compra como un solo grupo.
23. PASS — Centro de Mando no interpreta Compra como Tarea.
24. PASS — Reuniones y Tareas permanecen separadas.
25. PASS — Compras antiguas siguen funcionando.
26. PASS — No se modificó Inventario.
27. PASS — No se modificó Finanzas.
28. PASS — No se modificó POS.
29. PASS — No se modificó Producción.
30. PASS — Sin errores JavaScript ni errores de consola en las vistas probadas.
31. PASS — Sin scroll horizontal general en 1180 px, 768 px y 390 px.
32. PASS — Proyecto completo preparado para el ZIP.

## Validación técnica adicional

- `node --check agenda/purchases.js`: PASS.
- `node --check centro-mando/app.js`: PASS.
- Prueba automatizada Chromium de Agenda, edición, históricos, Presupuesto y responsive: PASS.
- Prueba automatizada Chromium de Centro de Mando y separación por tipo: PASS.
- Prueba automatizada de estados, eliminación de artículo y protección contra doble guardado: PASS.
