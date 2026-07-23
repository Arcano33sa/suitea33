# Suite A33 — Lotes — Disponibilidad — Etapa 3/3

- Estado visible VENDIDO derivado de Disponible/Producido por presentación.
- Mientras exista disponibilidad: EN EVENTO + PARCIAL.
- Cuando todas las presentaciones están en 0/x: VENDIDO único y verde.
- Estado operativo interno EN_EVENTO preservado para no romper POS, asignaciones ni trazabilidad.
- `availabilityState` persistido por POS para compatibilidad con JSON/Firebase y consumidores externos.
- Padres transferidos a lotes hijos permanecen CERRADO; hijos nacen DISPONIBLE.
- Reversiones restauran DISPONIBLE/PARCIAL según corresponda.
- Cache de Lotes incrementada: script r21 y módulo SW m24.
- Cache POS incrementada: app r34 y módulo SW m38 para entregar la persistencia automática sin contenido viejo.
- Pruebas históricas de Código de lote ajustadas para aceptar revisiones de caché posteriores sin falsos negativos.
