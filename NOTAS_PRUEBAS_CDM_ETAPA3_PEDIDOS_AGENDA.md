# Suite A33 — Centro de Mando — Etapa 3/5

## Cambios verificados
- Bloque Pedidos a ancho completo con vencidos, fabricar hoy, entregar hoy y máximo 3 urgentes.
- Pedidos completados, entregados o cancelados quedan excluidos.
- Cada pedido urgente conserva cliente, resumen de producto, fabricación, entrega y estado temporal.
- Bloque Agenda a ancho completo con Reuniones, Tareas y Compras separadas.
- Cada categoría muestra vencidas, para hoy y máximo 3 registros urgentes.
- Compras usa fecha necesaria/programada, cantidad de artículos, hasta 3 nombres, presupuesto y prioridad.
- Registros Hecho y Cancelado quedan excluidos.
- Accesos Abrir Pedidos y Abrir Agenda verificados.
- Lectura solamente: sin escritura sobre Pedidos, Agenda, JSON o Firebase.

## Pruebas ejecutadas
- `node --check centro-mando/app.js`
- `node tests/a33-cdm-etapa1-runtime.smoke.cjs`
- `node tests/a33-cdm-etapa1.smoke.cjs`
- `node tests/a33-cdm-etapa2.smoke.cjs`
- `node tests/a33-cdm-etapa3.smoke.cjs`

## Resultado
Todos los smoke tests finalizaron correctamente y sin errores de consola en los entornos simulados.
