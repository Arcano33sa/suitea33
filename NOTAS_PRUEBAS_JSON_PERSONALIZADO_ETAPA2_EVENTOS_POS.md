# Suite A33 — Respaldo JSON Personalizado — Etapa 2/4

Fecha y hora de entrega: 22/06/2026 08:30

## Cambios aplicados
- Se agregó acción “Seleccionar eventos” dentro de POS → Eventos en el exportador JSON personalizado.
- Se agregó modal A33 con listado compacto de eventos POS, checks, búsqueda, seleccionar todos, desmarcar todos, cancelar y aplicar selección.
- Cuando POS está completo/Todo POS, los eventos se exportan en modo `eventsMode: all` sin exigir selección manual.
- Cuando POS está parcial y se marca Eventos, la exportación exige seleccionar al menos un evento.
- El JSON parcial agrega metadata de POS: modo completo/parcial, `eventsMode`, `eventIdsIncluded`, nombres de eventos incluidos, cantidad y aviso de dependencia para ventas/cierres.
- La exportación parcial de Eventos POS filtra únicamente el store `a33-pos/events`; no arrastra ventas, cierres ni inventario salvo que el usuario marque esos submódulos.

## Pruebas realizadas
- `node --check configuracion/script.js` sin errores de sintaxis.
- Verificación estática de IDs, botones y estilos nuevos.
- Verificación de bump de assets en Configuración (`style.css r=22`, `script.js r=23`).

## Alcance protegido
- No se modificó POS operativo.
- No se modificaron ventas, cierres, inventario, Finanzas, Recibos, Lotes ni Calculadora.
- No se tocaron localStorage ni IndexedDB.
- No se agregó backend, Firebase ni dependencias nuevas.
