# Suite A33 — Agenda — Compras agrupadas — Etapa 1/3

## Cambios verificados
- Formulario multiartículo con botón **Agregar** junto a Estado.
- Retención de Fecha necesaria, Prioridad, Estado y Notas durante la preparación.
- Lista temporal con edición y eliminación de artículos.
- Fusión de artículos repetidos conservando el precio histórico inicial.
- Total general reactivo.
- Inclusión automática del último artículo válido al guardar.
- Guardado de una sola compra agrupada con `purchaseGroup.items` y compatibilidad `purchase` para lectores anteriores.
- Normalización segura de compras antiguas de un artículo.
- Preservación de `purchaseGroup` al guardar Reuniones o Tareas desde Agenda.
- Cache PWA de Agenda actualizado.

## Pruebas ejecutadas
- `node tests/a33-agenda-purchases-grouped-stage1.smoke.cjs`
- `node tests/a33-agenda-purchases-grouped-stage1-hardening.smoke.cjs`
- `node --check agenda/purchases.js`
- `node --check agenda/script.js`

Resultado: correcto, sin errores de consola en el entorno de smoke test.
