# Suite A33 — Centro de Mando y Agenda — Etapa 2/2

- Centro de Mando lee directamente `a33_agenda_records_v1`; no crea colección ni estado paralelo.
- Solo muestra registros `pendiente`, deduplicados por ID y agrupados en Vencidos, Para hoy, Próximos y Sin fecha.
- Pedido conserva la fecha principal y muestra entrega, producto, cantidad y prioridad como información adicional.
- La acción `Ver en Agenda` abre `agenda/index.html?record=<id>`; Agenda enfoca el registro sin modificar datos.
- La vista se actualiza al abrir, volver, recuperar visibilidad, recibir cambios de storage y eventos de importación/sincronización.
- Checklist permanece retirado de POS y se eliminó su acceso visible obsoleto desde Centro de Mando.
- Diseño responsive: columnas compactas en escritorio y bloques de dos/una columna en iPad/móvil, sin scroll horizontal general.
- Versión global: 4.20.93 r1.
