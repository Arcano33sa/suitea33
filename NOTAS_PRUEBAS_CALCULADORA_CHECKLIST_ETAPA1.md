# Suite A33 — Calculadora de Producción — Checklist — Etapa 1/2

## Alcance aplicado
- Se reemplazó el botón ancho por Calcular, Guardar Lote y Checklist en una fila de tres acciones iguales.
- Calcular conserva su función original.
- Guardar Lote conserva el mismo `id` y la misma función oficial de producción/inventario.
- Checklist abre una vista operativa con Histórico y Checklist.
- El Histórico lee únicamente `arcano33_lotes`, ordenado del más reciente al más antiguo.
- Usar carga los totales de ingredientes guardados o, para compatibilidad, los reconstruye desde snapshots de receta del lote.
- Las marcas del Checklist son visuales y temporales; no escriben Inventario, Lotes, Costos ni almacenamiento.
- Se actualizó únicamente la revisión de caché del módulo Calculadora.

## Verificaciones previstas
- HTML/JS sintácticamente válidos.
- Un solo `btn-guardar-lote` y bindings sin duplicación.
- Sin escrituras nuevas de almacenamiento desde Checklist.
- Vista sin error cuando no existen lotes o cuando un lote histórico carece de ingredientes.
